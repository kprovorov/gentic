import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "./errors"
import {
  getReviewRunContext,
  getReviewRunPublishContext,
} from "./review-context"
import type { Supabase } from "./types"

type DbRow = Record<string, unknown>

// A minimal PostgREST stand-in, mirroring the one in attachments.test.ts:
// enough of the query builder for `eq`/`is`/`not`/`order`/`maybeSingle` and a
// plain array `then`.
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
    this.predicates.push((row) => row[name] === value)
    return this
  }

  is(name: string, value: unknown) {
    this.predicates.push((row) => row[name] === value)
    return this
  }

  not(name: string, _op: string, value: unknown) {
    this.predicates.push((row) => row[name] !== value)
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

function fakeSupabase(tables: {
  review_runs?: DbRow[]
  issue_review_policies?: DbRow[]
  attachments?: DbRow[]
}): Supabase {
  return {
    from(table: "review_runs" | "issue_review_policies" | "attachments") {
      return new FakeQuery(tables[table] ?? [])
    },
    storage: {
      from() {
        return {
          createSignedUrl: async (path: string) => ({
            data: { signedUrl: `https://storage.example/${path}?token=t` },
            error: null,
          }),
        }
      },
    },
  } as unknown as Supabase
}

const reviewRunRow: DbRow = {
  id: "run-1",
  // The frozen SHA `getReviewRunPublishContext` reads — distinct from
  // `review_cycles.issue_pull_requests.head_sha` below, which can already
  // have moved by the time a completed run's verdict is published.
  head_sha: "frozen-sha-abc123",
  review_cycles: {
    issue_id: "issue-1",
    issue_pull_requests: {
      url: "https://github.com/gentic/app/pull/42",
      head_sha: "abc123",
      ci_state: "success",
    },
    issues: {
      number: 415,
      title: "Run the reviewer in an isolated read-only process",
      body: "Body",
      projects: { key: "GEN", repo: "gentic/app" },
    },
  },
}

const policyRow: DbRow = {
  issue_id: "issue-1",
  reviewer_provider: "claude_code",
  reviewer_model: null,
  reviewer_instructions: "Pay extra attention to auth boundaries.",
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

test("getReviewRunContext assembles issue, policy, PR, and attachment context", async () => {
  const supabase = fakeSupabase({
    review_runs: [reviewRunRow],
    issue_review_policies: [policyRow],
    attachments: [activeIssueAttachment],
  })

  assert.deepEqual(await getReviewRunContext(supabase, "run-1"), {
    issue: {
      code: "GEN-415",
      title: "Run the reviewer in an isolated read-only process",
      body: "Body",
    },
    attachments: [
      {
        id: "att-active",
        fileName: "spec.pdf",
        contentType: "application/pdf",
        sizeBytes: 2048,
        url: "https://storage.example/issue-1/att-active-spec.pdf?token=t",
      },
    ],
    repo: "gentic/app",
    reviewerProvider: "claude_code",
    reviewerModel: null,
    reviewerInstructions: "Pay extra attention to auth boundaries.",
    pullRequest: {
      url: "https://github.com/gentic/app/pull/42",
      headSha: "abc123",
      ciState: "success",
    },
  })
})

test("getReviewRunContext excludes attachments outside the issue's own durable set", async () => {
  const supabase = fakeSupabase({
    review_runs: [reviewRunRow],
    issue_review_policies: [policyRow],
    attachments: [
      activeIssueAttachment,
      // Message Attachment — excluded by kind.
      {
        ...activeIssueAttachment,
        id: "att-message",
        kind: "message",
        message_id: "message-1",
      },
      // Deleted — excluded.
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

  const context = await getReviewRunContext(supabase, "run-1")
  assert.deepEqual(
    context.attachments.map((attachment) => attachment.id),
    ["att-active"]
  )
})

test("getReviewRunPublishContext reads the run's own frozen head SHA, not the pull request's current one", async () => {
  const supabase = fakeSupabase({ review_runs: [reviewRunRow] })

  assert.deepEqual(await getReviewRunPublishContext(supabase, "run-1"), {
    repo: "gentic/app",
    prUrl: "https://github.com/gentic/app/pull/42",
    headSha: "frozen-sha-abc123",
  })
})

test("getReviewRunPublishContext throws not_found for an unknown review run", async () => {
  const supabase = fakeSupabase({ review_runs: [] })

  await assert.rejects(
    getReviewRunPublishContext(supabase, "missing-run"),
    (error: unknown) => {
      assert.ok(error instanceof ServiceError)
      assert.equal(error.code, "not_found")
      return true
    }
  )
})

test("getReviewRunContext returns an empty attachments list when the issue has none", async () => {
  const supabase = fakeSupabase({
    review_runs: [reviewRunRow],
    issue_review_policies: [policyRow],
    attachments: [],
  })

  const context = await getReviewRunContext(supabase, "run-1")
  assert.deepEqual(context.attachments, [])
})

test("getReviewRunContext rejects an unknown review run", async () => {
  const supabase = fakeSupabase({ review_runs: [] })

  await assert.rejects(
    () => getReviewRunContext(supabase, "missing-run"),
    (error: unknown) =>
      error instanceof ServiceError && error.code === "not_found"
  )
})

test("getReviewRunContext surfaces a missing frozen policy as an internal error", async () => {
  const supabase = fakeSupabase({
    review_runs: [reviewRunRow],
    issue_review_policies: [],
  })

  await assert.rejects(
    () => getReviewRunContext(supabase, "run-1"),
    (error: unknown) =>
      error instanceof ServiceError && error.code === "internal"
  )
})
