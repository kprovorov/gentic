import assert from "node:assert/strict"
import test from "node:test"

import { listHostIssueAttachments } from "../app/api/v1/agent/issues/[id]/attachments/route"

const issueId = "11111111-1111-4111-8111-111111111111"
const runId = "22222222-2222-4222-8222-222222222222"
const hostId = "33333333-3333-4333-8333-333333333333"
const messageId = "44444444-4444-4444-8444-444444444444"

type AttachmentRow = {
  id: string
  issue_id: string
  kind: string
  message_id: string | null
  file_name: string
  content_type: string | null
  size_bytes: number | null
  storage_path: string
  upload_completed_at: string | null
  deleted_at: string | null
}

function attachment(
  overrides: Partial<AttachmentRow> & Pick<AttachmentRow, "id">
): AttachmentRow {
  return {
    issue_id: issueId,
    kind: "issue",
    message_id: null,
    file_name: `${overrides.id}.txt`,
    content_type: "text/plain",
    size_bytes: 12,
    storage_path: `${issueId}/${overrides.id}.txt`,
    upload_completed_at: "2026-08-05T12:00:00.000Z",
    deleted_at: null,
    ...overrides,
  }
}

// Supabase query builders are thenable, and the route awaits this one
// directly, so the fake resolves itself the same way.
class FakeAttachmentsQuery {
  private equals: Array<[string, unknown]> = []
  private nulls: string[] = []
  private notNulls: string[] = []

  constructor(private readonly rows: AttachmentRow[]) {}

  select() {
    return this
  }

  order() {
    return this
  }

  eq(column: string, value: unknown) {
    this.equals.push([column, value])
    return this
  }

  is(column: string, value: unknown) {
    assert.equal(value, null)
    this.nulls.push(column)
    return this
  }

  not(column: string, operator: string, value: unknown) {
    assert.equal(operator, "is")
    assert.equal(value, null)
    this.notNulls.push(column)
    return this
  }

  then<TResult>(
    onfulfilled: (value: { data: AttachmentRow[]; error: null }) => TResult
  ): Promise<TResult> {
    const matches = this.rows.filter(
      (row) =>
        this.equals.every(
          ([column, value]) => row[column as keyof AttachmentRow] === value
        ) &&
        this.nulls.every(
          (column) => row[column as keyof AttachmentRow] === null
        ) &&
        this.notNulls.every(
          (column) => row[column as keyof AttachmentRow] !== null
        )
    )

    return Promise.resolve({ data: matches, error: null }).then(onfulfilled)
  }
}

class FakeIssuesQuery {
  private filters: Record<string, unknown> = {}

  select() {
    return this
  }

  eq(column: string, value: unknown) {
    this.filters[column] = value
    return this
  }

  maybeSingle() {
    if (this.filters.id !== issueId) {
      return Promise.resolve({ data: null, error: null })
    }
    if (
      "projects.user_id" in this.filters &&
      this.filters["projects.user_id"] !== "user-1"
    ) {
      return Promise.resolve({ data: null, error: null })
    }

    return Promise.resolve({
      data: {
        id: issueId,
        active_host_id: hostId,
        active_run_id: runId,
        projects: { user_id: "user-1" },
      },
      error: null,
    })
  }
}

function createSupabase(rows: AttachmentRow[]) {
  return {
    from(table: string) {
      if (table === "attachments") {
        return new FakeAttachmentsQuery(rows)
      }
      assert.equal(table, "issues")
      return new FakeIssuesQuery()
    },
    storage: {
      from(bucket: string) {
        assert.equal(bucket, "attachments")
        return {
          createSignedUrl(path: string) {
            return Promise.resolve({
              data: { signedUrl: `https://signed.test/${path}` },
              error: null,
            })
          },
        }
      },
    },
  }
}

const rows = [
  attachment({ id: "issue-spec" }),
  attachment({ id: "issue-incomplete", upload_completed_at: null }),
  attachment({ id: "issue-deleted", deleted_at: "2026-08-05T13:00:00.000Z" }),
  attachment({ id: "chat-file", kind: "message", message_id: messageId }),
  // A Message Attachment whose message was wiped by an agent reset. Its
  // `message_id` is null, but it is still not an Issue Attachment.
  attachment({ id: "chat-orphaned", kind: "message" }),
]

test("serves only the issue's own attachments when no message is named", async () => {
  const { attachments } = await listHostIssueAttachments(
    createSupabase(rows) as never,
    "user-1",
    hostId,
    issueId,
    { messageId: null, runId }
  )

  assert.deepEqual(
    attachments.map((entry) => entry.id),
    ["issue-spec"]
  )
  assert.equal(
    attachments[0]?.url,
    `https://signed.test/${issueId}/issue-spec.txt`
  )
})

test("serves only that message's attachments for a prompt turn", async () => {
  const { attachments } = await listHostIssueAttachments(
    createSupabase(rows) as never,
    "user-1",
    hostId,
    issueId,
    { messageId, runId }
  )

  assert.deepEqual(
    attachments.map((entry) => entry.id),
    ["chat-file"]
  )
})

test("rejects an issue the caller does not own", async () => {
  await assert.rejects(
    listHostIssueAttachments(
      createSupabase(rows) as never,
      "someone-else",
      hostId,
      issueId,
      { messageId: null, runId }
    ),
    { message: "Issue not found" }
  )
})

test("rejects a run that is not active for the calling host", async () => {
  await assert.rejects(
    listHostIssueAttachments(
      createSupabase(rows) as never,
      "user-1",
      hostId,
      issueId,
      { messageId: null, runId: "55555555-5555-4555-8555-555555555555" }
    ),
    { status: 409, message: "Run is not active for this host" }
  )
})
