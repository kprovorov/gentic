import assert from "node:assert/strict"
import { test } from "node:test"

import {
  applyChangesRequestedReview,
  applyTestsFailed,
  createManualFirstPrPublishMessage,
  formatChangesRequestedMessage,
  formatPullRequestCommentMessage,
  formatTestsFailedMessage,
  GENTIC_AUTHORED_USER_MESSAGE,
} from "./chat"

test("formatChangesRequestedMessage includes review body and inline comments", () => {
  const message = formatChangesRequestedMessage(
    "https://github.com/acme/widget/pull/42",
    {
      id: 1,
      reviewerLogin: "reviewer",
      body: "Needs another pass.",
      comments: [
        {
          path: "src/app.ts",
          line: 12,
          diffHunk: "@@ -1 +1 @@",
          body: "Handle null here.",
        },
      ],
    }
  )

  assert.match(message, /@reviewer requested changes/)
  assert.match(message, /Needs another pass\./)
  assert.match(message, /\*\*src\/app\.ts:12\*\*/)
  assert.match(message, /Handle null here\./)
})

test("formatPullRequestCommentMessage includes PR comment context", () => {
  const message = formatPullRequestCommentMessage(
    "https://github.com/acme/widget/pull/42",
    {
      id: 10,
      commenterLogin: "reviewer",
      body: "Please cover this edge case.",
      htmlUrl: "https://github.com/acme/widget/pull/42#discussion_r10",
      path: "src/app.ts",
      line: 12,
      diffHunk: "@@ -1 +1 @@",
    }
  )

  assert.match(message, /@reviewer commented on src\/app\.ts:12/)
  assert.match(message, /same branch/)
  assert.match(message, /discussion_r10/)
  assert.match(message, /Please cover this edge case\./)
})

test("formatTestsFailedMessage tells the agent to fix the same PR branch", () => {
  const message = formatTestsFailedMessage(
    "https://github.com/acme/widget/pull/42"
  )

  assert.match(message, /GitHub tests failed/)
  assert.match(message, /https:\/\/github.com\/acme\/widget\/pull\/42/)
  assert.match(message, /same branch/)
  assert.match(message, /do not open a new pull request/)
})

type Row = Record<string, unknown>

class TestsFailedQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<[string, unknown]> = []
  private updateValues: Row | null = null
  private insertValues: Row | null = null
  private selected = false

  constructor(
    private readonly table: "issues" | "messages" | "issue_pull_requests",
    private readonly db: TestsFailedDb
  ) {}

  select() {
    this.selected = true
    return this
  }

  eq(col: string, val: unknown) {
    this.filters.push([col, val])
    return this
  }

  maybeSingle() {
    return this
  }

  insert(values: Row) {
    this.insertValues = values
    return this
  }

  update(values: Row) {
    this.updateValues = values
    return this
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: unknown
          error: null
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected)
  }

  private matches(row: Row): boolean {
    return this.filters.every(([col, val]) => row[col] === val)
  }

  private rows(): Row[] {
    return this.db[this.table]
  }

  private async execute(): Promise<{ data: unknown; error: null }> {
    if (this.insertValues) {
      this.rows().push({
        id: `${this.table}-${this.rows().length + 1}`,
        ...this.insertValues,
      })
      return { data: null, error: null }
    }

    if (this.updateValues) {
      this.rows()
        .filter((row) => this.matches(row))
        .forEach((row) => Object.assign(row, this.updateValues))
    }

    if (this.selected) {
      return {
        data: this.rows().find((row) => this.matches(row)) ?? null,
        error: null,
      }
    }

    return { data: null, error: null }
  }
}

class TestsFailedDb {
  issues: Row[] = []
  messages: Row[] = []
  issue_pull_requests: Row[] = []

  from(table: "issues" | "messages" | "issue_pull_requests") {
    return new TestsFailedQuery(table, this)
  }
}

test("applyTestsFailed inserts a follow-up message and requeues the issue", async () => {
  const supabase = new TestsFailedDb()
  supabase.issues.push({ id: "issue-1", status: "tests-failed" })

  await applyTestsFailed(
    supabase as never,
    "issue-1",
    "https://github.com/acme/widget/pull/42"
  )

  assert.deepEqual(supabase.messages, [
    {
      id: "messages-1",
      issue_id: "issue-1",
      ...GENTIC_AUTHORED_USER_MESSAGE,
      content: formatTestsFailedMessage(
        "https://github.com/acme/widget/pull/42"
      ),
    },
  ])
  assert.equal(supabase.issues[0]?.status, "todo")
  assert.equal(supabase.issues[0]?.usage_limit_reset_at, null)
  assert.equal(typeof supabase.issues[0]?.updated_at, "string")
})

test("applyChangesRequestedReview inserts a Gentic-authored follow-up message", async () => {
  const supabase = new TestsFailedDb()
  supabase.issues.push({
    id: "issue-1",
    status: "changes-requested",
    projects: { auto_respond_to_reviews: true },
  })
  supabase.issue_pull_requests.push({
    id: "pr-1",
    issue_id: "issue-1",
    url: "https://github.com/acme/widget/pull/42",
  })

  await applyChangesRequestedReview(
    supabase as never,
    "https://github.com/acme/widget/pull/42",
    {
      id: 42,
      reviewerLogin: "reviewer",
      body: null,
      comments: [],
    }
  )

  assert.deepEqual(supabase.messages, [
    {
      id: "messages-1",
      issue_id: "issue-1",
      ...GENTIC_AUTHORED_USER_MESSAGE,
      content: formatChangesRequestedMessage(
        "https://github.com/acme/widget/pull/42",
        {
          id: 42,
          reviewerLogin: "reviewer",
          body: null,
          comments: [],
        }
      ),
      github_review_id: 42,
    },
  ])
  assert.equal(supabase.issues[0]?.status, "todo")
})

class ManualCreatePrQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<[string, unknown]> = []
  private inFilters: Array<[string, unknown[]]> = []
  private updateValues: Row | null = null
  private insertValues: Row | null = null
  private deleteRequested = false
  private wantsSingle = false
  private selected = false

  constructor(
    private readonly table:
      | "issues"
      | "issue_pull_requests"
      | "issue_automatic_pr_requests"
      | "messages",
    private readonly db: ManualCreatePrDb
  ) {}

  select() {
    this.selected = true
    return this
  }

  eq(col: string, val: unknown) {
    this.filters.push([col, val])
    return this
  }

  in(col: string, vals: unknown[]) {
    this.inFilters.push([col, vals])
    return this
  }

  not() {
    return this
  }

  order() {
    return this
  }

  limit() {
    return this
  }

  maybeSingle() {
    this.wantsSingle = true
    return this
  }

  single<T>() {
    this.wantsSingle = true
    return this as unknown as PromiseLike<{ data: T; error: null }>
  }

  insert(values: Row) {
    this.insertValues = values
    return this
  }

  update(values: Row) {
    this.updateValues = values
    return this
  }

  delete() {
    this.deleteRequested = true
    return this
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: unknown
          error: null
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected)
  }

  private matches(row: Row): boolean {
    return (
      this.filters.every(([col, val]) => {
        if (col === "projects.user_id") {
          return (row.projects as Row | undefined)?.user_id === val
        }
        return row[col] === val
      }) &&
      this.inFilters.every(([col, vals]) => vals.includes(row[col]))
    )
  }

  private rows(): Row[] {
    return this.db[this.table]
  }

  private selectedRow(row: Row): Row {
    return { ...row }
  }

  private async execute(): Promise<{ data: unknown; error: null }> {
    if (this.insertValues) {
      const row = {
        id: `manual-message-${this.db.messages.length + 1}`,
        created_at: "2026-07-29T12:00:00.000Z",
        ...this.insertValues,
      }
      this.rows().push(row)
      return {
        data: this.wantsSingle ? this.selectedRow(row) : [this.selectedRow(row)],
        error: null,
      }
    }

    if (this.deleteRequested) {
      const kept = this.rows().filter((row) => !this.matches(row))
      this.rows().length = 0
      this.rows().push(...kept)
      return { data: null, error: null }
    }

    if (this.updateValues) {
      this.rows()
        .filter((row) => this.matches(row))
        .forEach((row) => Object.assign(row, this.updateValues))
      return { data: null, error: null }
    }

    if (this.selected) {
      const rows = this.rows()
        .filter((row) => this.matches(row))
        .map((row) => this.selectedRow(row))
      return {
        data: this.wantsSingle ? (rows[0] ?? null) : rows,
        error: null,
      }
    }

    return { data: null, error: null }
  }
}

class ManualCreatePrDb {
  issues: Row[] = []
  issue_pull_requests: Row[] = []
  issue_automatic_pr_requests: Row[] = []
  messages: Row[] = []

  from(
    table:
      | "issues"
      | "issue_pull_requests"
      | "issue_automatic_pr_requests"
      | "messages"
  ) {
    return new ManualCreatePrQuery(table, this)
  }
}

function manualPrIssue(overrides: Row = {}) {
  return {
    id: "issue-manual-pr",
    number: 12,
    title: "Publish this work",
    status: "ready-for-review",
    active_run_id: null,
    has_unpublished_agent_changes: true,
    pr_url: null,
    projects: { key: "GEN", user_id: "user-1" },
    ...overrides,
  }
}

test("createManualFirstPrPublishMessage stores a user-authored first-PR request and requeues", async () => {
  const supabase = new ManualCreatePrDb()
  supabase.issues.push(manualPrIssue())

  const result = await createManualFirstPrPublishMessage(
    supabase as never,
    "user-1",
    "issue-manual-pr"
  )

  assert.equal(result.created, true)
  assert.match(result.content, /`gen-12-publish-this-work`/)
  assert.equal(supabase.messages.length, 1)
  assert.equal(supabase.messages[0]?.author_type, "user")
  assert.equal(supabase.messages[0]?.generated_action, "create_pr")
  assert.equal(supabase.issues[0]?.status, "todo")
})

test("createManualFirstPrPublishMessage rejects when the issue belongs to another user", async () => {
  const supabase = new ManualCreatePrDb()
  supabase.issues.push(manualPrIssue())

  await assert.rejects(
    createManualFirstPrPublishMessage(
      supabase as never,
      "another-user",
      "issue-manual-pr"
    ),
    { name: "ServiceError", code: "not_found" }
  )
  assert.equal(supabase.messages.length, 0)
})

test("createManualFirstPrPublishMessage is idempotent for duplicate manual clicks", async () => {
  const supabase = new ManualCreatePrDb()
  supabase.issues.push(manualPrIssue())

  const first = await createManualFirstPrPublishMessage(
    supabase as never,
    "user-1",
    "issue-manual-pr"
  )
  supabase.issues[0]!.status = "ready-for-review"
  const second = await createManualFirstPrPublishMessage(
    supabase as never,
    "user-1",
    "issue-manual-pr"
  )

  assert.equal(first.created, true)
  assert.equal(second.created, false)
  assert.equal(second.id, first.id)
  assert.equal(supabase.messages.length, 1)
})

test("createManualFirstPrPublishMessage allows recovery after an automatic attempt ended without a PR", async () => {
  const supabase = new ManualCreatePrDb()
  supabase.issues.push(manualPrIssue({ status: "run-failed" }))
  supabase.issue_automatic_pr_requests.push({
    id: "automatic-request-1",
    issue_id: "issue-manual-pr",
    run_id: "run-1",
    status: "failed",
  })
  supabase.messages.push({
    id: "automatic-message-1",
    issue_id: "issue-manual-pr",
    role: "user",
    author_type: "gentic",
    generated_action: "create_pr",
    created_at: "2026-07-29T11:00:00.000Z",
  })

  const result = await createManualFirstPrPublishMessage(
    supabase as never,
    "user-1",
    "issue-manual-pr"
  )

  assert.equal(result.created, true)
  assert.equal(supabase.messages.length, 2)
  assert.equal(supabase.messages[1]?.author_type, "user")
})

test("createManualFirstPrPublishMessage rejects while automatic publishing is pending", async () => {
  const supabase = new ManualCreatePrDb()
  supabase.issues.push(manualPrIssue())
  supabase.issue_automatic_pr_requests.push({
    id: "automatic-request-1",
    issue_id: "issue-manual-pr",
    run_id: "run-1",
    status: "pending",
  })

  await assert.rejects(
    createManualFirstPrPublishMessage(
      supabase as never,
      "user-1",
      "issue-manual-pr"
    ),
    { name: "ServiceError", code: "validation" }
  )
  assert.equal(supabase.messages.length, 0)
})
