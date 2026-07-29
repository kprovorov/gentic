import assert from "node:assert/strict"
import { test } from "node:test"

import {
  applyTestsFailed,
  formatChangesRequestedMessage,
  formatPullRequestCommentMessage,
  formatTestsFailedMessage,
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

  constructor(
    private readonly table: "issues" | "messages",
    private readonly db: TestsFailedDb
  ) {}

  eq(col: string, val: unknown) {
    this.filters.push([col, val])
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

    return { data: null, error: null }
  }
}

class TestsFailedDb {
  issues: Row[] = []
  messages: Row[] = []

  from(table: "issues" | "messages") {
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
      role: "user",
      content: formatTestsFailedMessage(
        "https://github.com/acme/widget/pull/42"
      ),
    },
  ])
  assert.equal(supabase.issues[0]?.status, "todo")
  assert.equal(supabase.issues[0]?.usage_limit_reset_at, null)
  assert.equal(typeof supabase.issues[0]?.updated_at, "string")
})
