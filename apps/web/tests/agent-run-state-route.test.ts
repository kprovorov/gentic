import assert from "node:assert/strict"
import test from "node:test"

import { finishIssueRun } from "../app/api/v1/agent/issues/[id]/run-state/route"

const issueId = "11111111-1111-4111-8111-111111111111"
const runId = "22222222-2222-4222-8222-222222222222"
const workerId = "33333333-3333-4333-8333-333333333333"

class FakeSupabase {
  readonly rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []

  from(table: string) {
    assert.equal(table, "issues")
    return new FakeIssueQuery()
  }

  rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args })
    return {
      single: () =>
        Promise.resolve({
          data: { finished: true, status: "tests-failed" },
          error: null,
        }),
    }
  }
}

class FakeIssueQuery {
  select() {
    return this
  }

  eq() {
    return this
  }

  maybeSingle() {
    return Promise.resolve({
      data: {
        id: issueId,
        active_worker_id: workerId,
        active_run_id: runId,
        projects: { user_id: "user-1" },
      },
      error: null,
    })
  }
}

function finishBody() {
  return {
    active_run_id: runId,
    status: "waiting-for-input",
    run_finished_at: "2026-08-06T12:00:00.000Z",
    finish_if_no_pending: true,
  }
}

test("finish rejects a pull request URL at the route boundary", async () => {
  const supabase = new FakeSupabase()

  await assert.rejects(
    finishIssueRun(supabase as never, "user-1", workerId, issueId, {
      ...finishBody(),
      pr_url: "https://github.com/acme/repo/pull/42",
    }),
    { name: "ZodError" }
  )
  assert.deepEqual(supabase.rpcCalls, [])
})

test("finish omits the legacy URL argument and returns association-derived status", async () => {
  const supabase = new FakeSupabase()

  const result = await finishIssueRun(
    supabase as never,
    "user-1",
    workerId,
    issueId,
    finishBody()
  )

  assert.deepEqual(result, { finished: true, status: "tests-failed" })
  assert.deepEqual(supabase.rpcCalls, [
    {
      name: "finish_issue_run_if_no_pending",
      args: {
        p_issue_id: issueId,
        p_run_id: runId,
        p_status: "waiting-for-input",
        p_run_finished_at: "2026-08-06T12:00:00.000Z",
      },
    },
  ])
})
