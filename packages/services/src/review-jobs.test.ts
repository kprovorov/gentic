import assert from "node:assert/strict"
import test from "node:test"

import { claimReviewRun } from "./review-jobs"

function rpcClient(data: unknown, error: unknown = null) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = []
  const client = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args })
      return Promise.resolve({ data, error })
    },
  }
  return { client, calls }
}

test("claimReviewRun maps a claimed run", async () => {
  const { client, calls } = rpcClient([
    {
      review_run_id: "run-1",
      review_cycle_id: "cycle-1",
      issue_id: "issue-1",
      pull_request_id: "pr-1",
      head_sha: "abc123",
    },
  ])

  const result = await claimReviewRun(client as never, "host-1", "user-1")

  assert.deepEqual(result, {
    reviewRunId: "run-1",
    reviewCycleId: "cycle-1",
    issueId: "issue-1",
    pullRequestId: "pr-1",
    headSha: "abc123",
  })
  assert.deepEqual(calls, [
    {
      name: "claim_review_run",
      args: { p_host_id: "host-1", p_user_id: "user-1" },
    },
  ])
})

test("claimReviewRun returns null when nothing is claimable", async () => {
  const { client } = rpcClient([])
  const result = await claimReviewRun(client as never, "host-1", "user-1")
  assert.equal(result, null)
})
