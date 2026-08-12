import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "./errors"
import {
  ATTACHMENT_DOWNLOAD_URL_TTL_SECONDS,
  attachmentOwnerColumns,
  attachmentOwnerForMessage,
  createIssueAttachmentDownloadUrl,
  groupMessageAttachments,
  listIssueAttachments,
  MAX_ATTACHMENT_BYTES,
  rollbackMessageAttachmentUpload,
  selectIssueAttachments,
  selectMessageAttachments,
  validateAttachmentBatch,
} from "./attachments"
import type { Supabase } from "./types"

type AttachmentRow = {
  id: string
  kind: string
  message_id: string | null
  upload_completed_at: string | null
  deleted_at: string | null
}

function attachment(overrides: Partial<AttachmentRow> = {}): AttachmentRow {
  return {
    id: "attachment-1",
    kind: "issue",
    message_id: null,
    upload_completed_at: "2026-08-05T12:00:00.000Z",
    deleted_at: null,
    ...overrides,
  }
}

test("attachmentOwnerColumns keeps issue attachments free of a message owner", () => {
  assert.deepEqual(attachmentOwnerColumns(attachmentOwnerForMessage(null)), {
    kind: "issue",
    message_id: null,
  })
  assert.deepEqual(
    attachmentOwnerColumns(attachmentOwnerForMessage("message-1")),
    { kind: "message", message_id: "message-1" }
  )
})

test("selectIssueAttachments keeps issue uploads and drops message uploads", () => {
  const durable = attachment({ id: "issue-file" })

  assert.deepEqual(
    selectIssueAttachments([
      durable,
      attachment({ id: "chat-file", kind: "message", message_id: "message-1" }),
      // A message attachment orphaned by an agent reset is on its way out, so
      // it must not resurface as an issue attachment.
      attachment({ id: "orphaned-chat-file", kind: "message" }),
      attachment({ id: "half-uploaded", upload_completed_at: null }),
      attachment({ id: "removed", deleted_at: "2026-08-05T12:30:00.000Z" }),
    ]),
    [durable]
  )
})

test("selectIssueAttachments survives a conversation reset", () => {
  const rows = [
    attachment({ id: "issue-file" }),
    attachment({ id: "chat-file", kind: "message", message_id: "message-1" }),
  ]
  // A reset deletes the issue's messages, which nulls `message_id`
  // (`on delete set null`) without touching the issue's own uploads.
  const afterReset = rows.map((row) =>
    row.kind === "message" ? { ...row, message_id: null } : row
  )

  assert.deepEqual(
    selectIssueAttachments(afterReset).map((row) => row.id),
    ["issue-file"]
  )
})

test("selectMessageAttachments keeps only chat uploads that still exist", () => {
  const chatFile = attachment({
    id: "chat-file",
    kind: "message",
    message_id: "message-1",
  })

  assert.deepEqual(
    selectMessageAttachments([
      attachment({ id: "issue-file" }),
      chatFile,
      // Unlike the transcript, a file listing shows what is still there: a
      // deleted upload has no bytes left to download, and one orphaned by a
      // reset is on its way out.
      attachment({
        id: "removed",
        kind: "message",
        message_id: "message-1",
        deleted_at: "2026-08-05T12:30:00.000Z",
      }),
      attachment({ id: "orphaned-chat-file", kind: "message" }),
      attachment({
        id: "half-uploaded",
        kind: "message",
        message_id: "message-2",
        upload_completed_at: null,
      }),
    ]),
    [chatFile]
  )
})

test("groupMessageAttachments keys delivered uploads by their message", () => {
  const grouped = groupMessageAttachments([
    attachment({ id: "issue-file" }),
    attachment({ id: "chat-1", kind: "message", message_id: "message-1" }),
    attachment({ id: "chat-2", kind: "message", message_id: "message-1" }),
    attachment({
      id: "chat-deleted",
      kind: "message",
      message_id: "message-2",
      deleted_at: "2026-08-05T12:30:00.000Z",
    }),
    attachment({
      id: "chat-never-uploaded",
      kind: "message",
      message_id: "message-2",
      upload_completed_at: null,
    }),
    attachment({ id: "chat-orphaned", kind: "message" }),
  ])

  assert.deepEqual(
    [...grouped].map(([messageId, rows]) => [
      messageId,
      rows.map((row) => row.id),
    ]),
    [
      ["message-1", ["chat-1", "chat-2"]],
      ["message-2", ["chat-deleted"]],
    ]
  )
})

test("validateAttachmentBatch allows duplicate filenames within prompt limits", () => {
  assert.doesNotThrow(() =>
    validateAttachmentBatch([
      { name: "notes.txt", size: 1024 },
      { name: "notes.txt", size: 2048 },
    ])
  )
})

test("validateAttachmentBatch enforces per-file and aggregate limits", () => {
  assert.throws(
    () =>
      validateAttachmentBatch([
        { name: "large.bin", size: MAX_ATTACHMENT_BYTES + 1 },
      ]),
    (error) =>
      error instanceof ServiceError &&
      error.code === "validation" &&
      error.message.includes("larger than 25MB")
  )

  assert.throws(
    () =>
      validateAttachmentBatch([
        { name: "a.bin", size: 20 * 1024 * 1024 },
        { name: "b.bin", size: 20 * 1024 * 1024 },
        { name: "c.bin", size: 20 * 1024 * 1024 },
      ]),
    (error) =>
      error instanceof ServiceError &&
      error.code === "validation" &&
      error.message.includes("cannot exceed 50MB")
  )
})

type DbRow = Record<string, unknown>

function column(row: DbRow, name: string): unknown {
  if (name === "projects.user_id") {
    return (row.projects as DbRow | undefined)?.user_id
  }
  return row[name]
}

// A minimal PostgREST stand-in: enough of the query builder for the two
// attachment queries and the ownership join they lean on.
class FakeQuery {
  private readonly predicates: Array<(row: DbRow) => boolean> = []

  constructor(private readonly rows: DbRow[]) {}

  select() {
    return this
  }

  order() {
    return this
  }

  eq(name: string, value: unknown) {
    this.predicates.push((row) => column(row, name) === value)
    return this
  }

  is(name: string, value: unknown) {
    this.predicates.push((row) => column(row, name) === value)
    return this
  }

  not(name: string, _op: string, value: unknown) {
    this.predicates.push((row) => column(row, name) !== value)
    return this
  }

  private matched() {
    return this.rows.filter((row) => this.predicates.every((p) => p(row)))
  }

  async maybeSingle() {
    return { data: this.matched()[0] ?? null, error: null }
  }

  then<T>(
    onfulfilled: (value: { data: DbRow[]; error: null }) => T | PromiseLike<T>
  ) {
    return Promise.resolve({ data: this.matched(), error: null }).then(
      onfulfilled
    )
  }
}

type SignResult = { data: { signedUrl: string } | null; error: { message: string } | null }

function fakeSupabase(
  tables: { attachments?: DbRow[]; issues?: DbRow[] },
  sign: (path: string) => SignResult = (path) => ({
    data: { signedUrl: `https://storage.example/${path}?token=t` },
    error: null,
  }),
  signCalls: string[] = []
): Supabase {
  return {
    from(table: "attachments" | "issues") {
      return new FakeQuery(tables[table] ?? [])
    },
    storage: {
      from() {
        return {
          createSignedUrl: async (path: string) => {
            signCalls.push(path)
            return sign(path)
          },
        }
      },
    },
  } as unknown as Supabase
}

const activeIssueAttachment: DbRow = {
  id: "att-active",
  issue_id: "issue-1",
  kind: "issue",
  message_id: null,
  file_name: "spec.pdf",
  content_type: "application/pdf",
  size_bytes: 2048,
  storage_path: "issue-1/att-active-spec.pdf",
  upload_completed_at: "2026-08-05T12:00:00.000Z",
  deleted_at: null,
}

test("listIssueAttachments returns only active Issue Attachment metadata for the issue", async () => {
  const supabase = fakeSupabase({
    attachments: [
      activeIssueAttachment,
      // Message Attachment — excluded by kind.
      {
        ...activeIssueAttachment,
        id: "att-message",
        kind: "message",
        message_id: "message-1",
      },
      // Deleted Issue Attachment — excluded.
      {
        ...activeIssueAttachment,
        id: "att-deleted",
        deleted_at: "2026-08-05T12:30:00.000Z",
      },
      // Incomplete upload — excluded.
      {
        ...activeIssueAttachment,
        id: "att-incomplete",
        upload_completed_at: null,
      },
      // Belongs to another issue — excluded.
      { ...activeIssueAttachment, id: "att-other", issue_id: "issue-2" },
    ],
  })

  assert.deepEqual(await listIssueAttachments(supabase, "issue-1"), [
    {
      id: "att-active",
      file_name: "spec.pdf",
      content_type: "application/pdf",
      size_bytes: 2048,
    },
  ])
})

test("createIssueAttachmentDownloadUrl signs an owned active Issue Attachment", async () => {
  const signCalls: string[] = []
  const supabase = fakeSupabase(
    {
      attachments: [activeIssueAttachment],
      issues: [{ id: "issue-1", projects: { user_id: "user-1" } }],
    },
    undefined,
    signCalls
  )

  assert.deepEqual(
    await createIssueAttachmentDownloadUrl(supabase, "user-1", "att-active"),
    {
      id: "att-active",
      file_name: "spec.pdf",
      content_type: "application/pdf",
      size_bytes: 2048,
      url: "https://storage.example/issue-1/att-active-spec.pdf?token=t",
      expires_in_seconds: ATTACHMENT_DOWNLOAD_URL_TTL_SECONDS,
    }
  )
  assert.deepEqual(signCalls, ["issue-1/att-active-spec.pdf"])
})

test("createIssueAttachmentDownloadUrl hides foreign, deleted, incomplete, and Message Attachment ids behind one not-found error", async () => {
  const owner = { id: "issue-1", projects: { user_id: "user-1" } }

  const cases: Array<{ label: string; attachments: DbRow[]; issues: DbRow[] }> =
    [
      {
        label: "foreign issue",
        attachments: [activeIssueAttachment],
        issues: [{ id: "issue-1", projects: { user_id: "someone-else" } }],
      },
      {
        label: "deleted",
        attachments: [
          {
            ...activeIssueAttachment,
            deleted_at: "2026-08-05T12:30:00.000Z",
          },
        ],
        issues: [owner],
      },
      {
        label: "incomplete upload",
        attachments: [{ ...activeIssueAttachment, upload_completed_at: null }],
        issues: [owner],
      },
      {
        label: "Message Attachment",
        attachments: [
          {
            ...activeIssueAttachment,
            kind: "message",
            message_id: "message-1",
          },
        ],
        issues: [owner],
      },
      { label: "unknown id", attachments: [], issues: [owner] },
    ]

  for (const { label, attachments, issues } of cases) {
    const signCalls: string[] = []
    const supabase = fakeSupabase({ attachments, issues }, undefined, signCalls)

    await assert.rejects(
      () => createIssueAttachmentDownloadUrl(supabase, "user-1", "att-active"),
      (error: unknown) =>
        error instanceof ServiceError &&
        error.code === "not_found" &&
        error.message === "Attachment not found",
      label
    )
    // Nothing is signed for a rejected request, so no storage detail leaks.
    assert.deepEqual(signCalls, [], label)
  }
})

test("createIssueAttachmentDownloadUrl surfaces a signing failure as an internal error", async () => {
  const supabase = fakeSupabase(
    {
      attachments: [activeIssueAttachment],
      issues: [{ id: "issue-1", projects: { user_id: "user-1" } }],
    },
    () => ({ data: null, error: { message: "storage unavailable" } })
  )

  await assert.rejects(
    () => createIssueAttachmentDownloadUrl(supabase, "user-1", "att-active"),
    (error: unknown) =>
      error instanceof ServiceError && error.code === "internal"
  )
})

test("rollbackMessageAttachmentUpload removes blobs, marks rows, then deletes message", async () => {
  const calls: string[] = []

  await rollbackMessageAttachmentUpload(
    {
      async listAttachments(issueId, messageId) {
        calls.push(`list:${issueId}:${messageId}`)
        return [
          { id: "att-1", storage_path: "issue/msg/file.txt" },
          { id: "att-2", storage_path: "issue/msg/file.txt" },
        ]
      },
      async removeStorageObjects(paths) {
        calls.push(`remove:${paths.join(",")}`)
      },
      async markAttachmentsDeleted(ids, storageDeletedAt) {
        calls.push(
          `mark:${ids.join(",")}:${storageDeletedAt ? "deleted" : "missing"}`
        )
      },
      async deleteMessage(issueId, messageId) {
        calls.push(`delete-message:${issueId}:${messageId}`)
      },
    },
    "issue-1",
    "message-1"
  )

  assert.deepEqual(calls, [
    "list:issue-1:message-1",
    "remove:issue/msg/file.txt,issue/msg/file.txt",
    "mark:att-1,att-2:deleted",
    "delete-message:issue-1:message-1",
  ])
})

test("rollbackMessageAttachmentUpload still marks rows and deletes message when blob cleanup fails", async () => {
  const calls: string[] = []

  await rollbackMessageAttachmentUpload(
    {
      async listAttachments() {
        calls.push("list")
        return [{ id: "att-1", storage_path: "issue/msg/file.txt" }]
      },
      async removeStorageObjects() {
        calls.push("remove")
        throw new Error("storage unavailable")
      },
      async markAttachmentsDeleted(ids, storageDeletedAt) {
        calls.push(
          `mark:${ids.join(",")}:${storageDeletedAt ? "deleted" : "missing"}`
        )
      },
      async deleteMessage() {
        calls.push("delete-message")
      },
    },
    "issue-1",
    "message-1"
  )

  assert.deepEqual(calls, [
    "list",
    "remove",
    "mark:att-1:missing",
    "delete-message",
  ])
})

test("rollbackMessageAttachmentUpload deletes failed messages with no attachment rows", async () => {
  const calls: string[] = []

  await rollbackMessageAttachmentUpload(
    {
      async listAttachments() {
        calls.push("list")
        return []
      },
      async removeStorageObjects() {
        calls.push("remove")
      },
      async markAttachmentsDeleted() {
        calls.push("mark")
      },
      async deleteMessage() {
        calls.push("delete-message")
      },
    },
    "issue-1",
    "message-1"
  )

  assert.deepEqual(calls, ["list", "delete-message"])
})
