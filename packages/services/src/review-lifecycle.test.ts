import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "./errors"
import {
  completeReviewAttempt,
  continueWithHumanReview,
  deliverReviewFixRequest,
  evaluateReviewEligibility,
  failReviewRun,
  isKnownReviewAttempt,
  shouldDeliverReviewFix,
  supersedeActiveReviewCycle,
} from "./review-lifecycle"

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

test("evaluateReviewEligibility maps a queued run", async () => {
  const { client, calls } = rpcClient([
    {
      issue_id: "issue-1",
      pull_request_id: "pr-1",
      eligible: true,
      review_cycle_id: "cycle-1",
      review_run_id: "run-1",
      action: "queued",
    },
  ])

  const result = await evaluateReviewEligibility(
    client as never,
    "https://github.com/acme/repo/pull/1"
  )

  assert.deepEqual(result, {
    issueId: "issue-1",
    pullRequestId: "pr-1",
    eligible: true,
    reviewCycleId: "cycle-1",
    reviewRunId: "run-1",
    action: "queued",
  })
  assert.deepEqual(calls, [
    {
      name: "evaluate_review_eligibility",
      args: { p_pr_url: "https://github.com/acme/repo/pull/1" },
    },
  ])
})

test("evaluateReviewEligibility returns null for an untracked pull request", async () => {
  const { client } = rpcClient([])
  const result = await evaluateReviewEligibility(client as never, "https://github.com/acme/repo/pull/9")
  assert.equal(result, null)
})

test("completeReviewAttempt sends findings in snake_case and maps the result", async () => {
  const { client, calls } = rpcClient([
    {
      review_attempt_id: "attempt-1",
      review_cycle_id: "cycle-1",
      issue_id: "issue-1",
      attempt_number: 1,
      cycle_state: "active",
      accepted: true,
    },
  ])

  const result = await completeReviewAttempt(client as never, {
    reviewRunId: "run-1",
    verdict: "changes_requested",
    summary: "Needs work",
    findings: [
      {
        title: "Null deref",
        severity: "warning",
        filePath: "a.ts",
        line: 10,
        evidence: "line 10 dereferences `user` without a null check",
        impact: "crashes on any request with no authenticated user",
        requestedChange: "add a null check before dereferencing `user`",
      },
    ],
  })

  assert.deepEqual(result, {
    reviewAttemptId: "attempt-1",
    reviewCycleId: "cycle-1",
    issueId: "issue-1",
    attemptNumber: 1,
    cycleState: "active",
    accepted: true,
  })
  assert.deepEqual(calls[0].args, {
    p_review_run_id: "run-1",
    p_verdict: "changes_requested",
    p_summary: "Needs work",
    p_github_review_id: undefined,
    p_findings: [
      {
        severity: "warning",
        file_path: "a.ts",
        line: 10,
        title: "Null deref",
        body: null,
        evidence: "line 10 dereferences `user` without a null check",
        impact: "crashes on any request with no authenticated user",
        requested_change: "add a null check before dereferencing `user`",
        github_comment_id: null,
      },
    ],
  })
})

test("completeReviewAttempt throws not_found for an unknown run", async () => {
  const { client } = rpcClient([])
  await assert.rejects(
    completeReviewAttempt(client as never, { reviewRunId: "missing", verdict: "approved" }),
    (error: unknown) => {
      assert.ok(error instanceof ServiceError)
      assert.equal(error.code, "not_found")
      return true
    }
  )
})

test("failReviewRun maps a retry", async () => {
  const { client } = rpcClient([
    {
      review_run_id: "run-1",
      review_cycle_id: "cycle-1",
      retried: true,
      next_review_run_id: "run-2",
      accepted: true,
    },
  ])

  const result = await failReviewRun(client as never, { reviewRunId: "run-1", error: "boom" })
  assert.deepEqual(result, {
    reviewRunId: "run-1",
    reviewCycleId: "cycle-1",
    retried: true,
    nextReviewRunId: "run-2",
    accepted: true,
  })
})

test("supersedeActiveReviewCycle defaults to not-superseded when nothing to supersede", async () => {
  const { client, calls } = rpcClient([{ review_cycle_id: null, superseded: false }])

  const result = await supersedeActiveReviewCycle(
    client as never,
    "https://github.com/acme/repo/pull/1",
    "human_review"
  )

  assert.deepEqual(result, { reviewCycleId: null, superseded: false })
  assert.deepEqual(calls[0].args, {
    p_pr_url: "https://github.com/acme/repo/pull/1",
    p_reason: "human_review",
  })
})

test("continueWithHumanReview maps P0002 to not_found", async () => {
  const client = {
    rpc() {
      return {
        single: () =>
          Promise.resolve({ data: null, error: { code: "P0002", message: "Issue not found" } }),
      }
    },
  }

  await assert.rejects(
    continueWithHumanReview(client as never, "user-1", "issue-1"),
    (error: unknown) => {
      assert.ok(error instanceof ServiceError)
      assert.equal(error.code, "not_found")
      return true
    }
  )
})

test("continueWithHumanReview maps 23514 to validation", async () => {
  const client = {
    rpc() {
      return {
        single: () =>
          Promise.resolve({
            data: null,
            error: { code: "23514", message: "No active automatic review cycle to continue" },
          }),
      }
    },
  }

  await assert.rejects(
    continueWithHumanReview(client as never, "user-1", "issue-1"),
    (error: unknown) => {
      assert.ok(error instanceof ServiceError)
      assert.equal(error.code, "validation")
      return true
    }
  )
})

test("continueWithHumanReview returns the approved cycle", async () => {
  const client = {
    rpc() {
      return {
        single: () =>
          Promise.resolve({
            data: { review_cycle_id: "cycle-1", issue_id: "issue-1", status: "approved" },
            error: null,
          }),
      }
    },
  }

  const result = await continueWithHumanReview(client as never, "user-1", "issue-1")
  assert.deepEqual(result, { reviewCycleId: "cycle-1", issueId: "issue-1", status: "approved" })
})

test("isKnownReviewAttempt is true when a review_attempts row matches the GitHub review id", async () => {
  const client = {
    from(table: string) {
      assert.equal(table, "review_attempts")
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          assert.equal(column, "github_review_id")
          assert.equal(value, 555)
          return builder
        },
        maybeSingle: () => Promise.resolve({ data: { id: "attempt-1" }, error: null }),
      }
      return builder
    },
  }

  assert.equal(await isKnownReviewAttempt(client as never, 555), true)
})

test("isKnownReviewAttempt is false for a genuine human review", async () => {
  const client = {
    from() {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
      }
      return builder
    },
  }

  assert.equal(await isKnownReviewAttempt(client as never, 999), false)
})

test("deliverReviewFixRequest maps a delivered outcome", async () => {
  const { client, calls } = rpcClient([
    {
      review_attempt_id: "attempt-1",
      issue_id: "issue-1",
      outcome: "delivered",
      unavailable_reason: null,
    },
  ])

  const result = await deliverReviewFixRequest(client as never, {
    reviewAttemptId: "attempt-1",
    content: "Push fixes to the same branch.",
  })

  assert.deepEqual(result, {
    reviewAttemptId: "attempt-1",
    issueId: "issue-1",
    outcome: "delivered",
    unavailableReason: null,
  })
  assert.deepEqual(calls[0].args, {
    p_review_attempt_id: "attempt-1",
    p_content: "Push fixes to the same branch.",
  })
})

test("deliverReviewFixRequest maps an owner-unavailable outcome with its reason", async () => {
  const { client } = rpcClient([
    {
      review_attempt_id: "attempt-1",
      issue_id: "issue-1",
      outcome: "owner_unavailable",
      unavailable_reason: "worker_banned",
    },
  ])

  const result = await deliverReviewFixRequest(client as never, {
    reviewAttemptId: "attempt-1",
    content: "Push fixes to the same branch.",
  })

  assert.equal(result.outcome, "owner_unavailable")
  assert.equal(result.unavailableReason, "worker_banned")
})

test("deliverReviewFixRequest throws not_found when the RPC returns no row", async () => {
  const { client } = rpcClient([])

  await assert.rejects(
    deliverReviewFixRequest(client as never, {
      reviewAttemptId: "missing",
      content: "content",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ServiceError)
      assert.equal(error.code, "not_found")
      return true
    }
  )
})

test("shouldDeliverReviewFix is true only for an accepted, active-cycle changes_requested verdict", () => {
  const base = {
    accepted: true as const,
    cycleState: "active",
    reviewAttemptId: "attempt-1",
  }

  assert.equal(shouldDeliverReviewFix(base, "changes_requested"), true)
})

test("shouldDeliverReviewFix is false when the run's verdict was not accepted (stale/superseded)", () => {
  assert.equal(
    shouldDeliverReviewFix(
      { accepted: false, cycleState: null, reviewAttemptId: null },
      "changes_requested"
    ),
    false
  )
})

test("shouldDeliverReviewFix is false for a verdict other than changes_requested", () => {
  assert.equal(
    shouldDeliverReviewFix(
      { accepted: true, cycleState: "active", reviewAttemptId: "attempt-1" },
      "approved"
    ),
    false
  )
})

test("shouldDeliverReviewFix is false once the cycle is exhausted (third attempt)", () => {
  assert.equal(
    shouldDeliverReviewFix(
      { accepted: true, cycleState: "exhausted", reviewAttemptId: "attempt-1" },
      "changes_requested"
    ),
    false
  )
})
