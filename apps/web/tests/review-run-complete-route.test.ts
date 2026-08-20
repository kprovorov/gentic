import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "@gentic/services/errors"

import { completeReviewRun } from "../app/api/v1/agent/review-runs/[id]/complete/route"

type Row = Record<string, unknown>

class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<(row: Row) => boolean> = []

  constructor(private readonly rows: Row[]) {}

  select() {
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value)
    return this
  }

  maybeSingle() {
    return Promise.resolve({
      data:
        this.rows.filter((row) => this.filters.every((f) => f(row)))[0] ?? null,
      error: null,
    })
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: unknown
          error: null
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.maybeSingle().then(onfulfilled, onrejected)
  }
}

// Only exercises the "no GitHub integration" branch: enough to prove
// `completeReviewRun` publishes to GitHub *before* it ever reaches
// `completeReviewAttempt` (the rpc call below is never wired up, so a
// reordering that called it first would throw a clear "not a function"
// failure instead of silently passing).
function fakeSupabase(reviewRunRow: Row) {
  return {
    from(table: string) {
      if (table === "review_runs") {
        return new FakeQuery([reviewRunRow])
      }
      if (table === "github_integrations") {
        return new FakeQuery([])
      }
      throw new Error(`Unexpected table in fake supabase: ${table}`)
    },
  } as never
}

const reviewRunRow: Row = {
  id: "run-1",
  head_sha: "sha-current",
  review_cycles: {
    issue_pull_requests: { url: "https://github.com/acme/widget/pull/42" },
    issues: { projects: { repo: "acme/widget" } },
  },
}

test("completeReviewRun publishes to GitHub before recording a verdict, and never trusts a client-supplied githubReviewId", async () => {
  const supabase = fakeSupabase(reviewRunRow)

  await assert.rejects(
    completeReviewRun(supabase, "user-1", "run-1", {
      verdict: "changes_requested",
      summary: "Please fix this",
      // A forged id: if this ever reached `completeReviewAttempt` it would
      // let a request author `review_attempts.github_review_id` itself.
      githubReviewId: 1234567,
      findings: [],
    }),
    (error: unknown) => {
      assert.ok(error instanceof ServiceError)
      // "forbidden" (no GitHub integration) proves publish ran first — a
      // reordering that called `completeReviewAttempt` first would instead
      // fail with the fake's unimplemented `.rpc`.
      assert.equal(error.code, "forbidden")
      return true
    }
  )
})
