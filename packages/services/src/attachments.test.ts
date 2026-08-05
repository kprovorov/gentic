import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "./errors"
import {
  attachmentOwnerColumns,
  attachmentOwnerForMessage,
  groupMessageAttachments,
  MAX_ATTACHMENT_BYTES,
  rollbackMessageAttachmentUpload,
  selectIssueAttachments,
  validateAttachmentBatch,
} from "./attachments"

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
