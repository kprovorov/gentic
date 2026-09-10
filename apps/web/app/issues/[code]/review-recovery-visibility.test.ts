import assert from "node:assert/strict"
import { test } from "node:test"

import type { ImplementationOwner, ReviewCycle } from "@gentic/services/issues"

import { findReviewRetryTarget } from "@/app/issues/review-state-meta"

import { hasReviewRecoveryControls } from "./review-recovery-visibility"

function cycle(overrides: Partial<ReviewCycle> = {}): ReviewCycle {
  return {
    id: "cycle-1",
    pullRequestId: "pr-1",
    state: "active",
    headSha: "sha-1",
    supersededReason: null,
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-25T00:00:00.000Z",
    runs: [],
    attempts: [],
    ...overrides,
  }
}

function owner(
  overrides: Partial<ImplementationOwner> = {}
): ImplementationOwner {
  return {
    id: "owner-1",
    issueId: "issue-1",
    generation: 1,
    origin: "implementation",
    hostId: "host-1",
    sessionId: "session-1",
    agentProvider: "claude_code",
    issueModel: null,
    establishedAt: "2026-08-25T00:00:00.000Z",
    resumable: true,
    unavailableReason: null,
    ...overrides,
  }
}

test("no controls when there are no cycles and no owner", () => {
  assert.equal(hasReviewRecoveryControls([], null), false)
})

test("Retry: a cycle stuck with two trailing failures and budget left is a retry target", () => {
  const stuck = cycle({
    runs: [
      {
        id: "run-1",
        status: "failed",
        error: "boom",
        headSha: "sha-1",
        startedAt: null,
        finishedAt: "t",
        claimedByHostId: null,
        heartbeatAt: null,
        createdAt: "t",
      },
      {
        id: "run-2",
        status: "failed",
        error: "boom again",
        headSha: "sha-1",
        startedAt: null,
        finishedAt: "t",
        claimedByHostId: null,
        heartbeatAt: null,
        createdAt: "t",
      },
    ],
  })

  assert.equal(hasReviewRecoveryControls([stuck], null), true)
})

test("Retry: a cycle with a live run is a forced-restart target", () => {
  const live = cycle({
    runs: [
      {
        id: "run-1",
        status: "running",
        error: null,
        headSha: "sha-1",
        startedAt: "t",
        finishedAt: null,
        claimedByHostId: "host-1",
        heartbeatAt: "t",
        createdAt: "t",
      },
    ],
  })

  assert.equal(hasReviewRecoveryControls([live], null), true)
  assert.deepEqual(findReviewRetryTarget([live]), { cycle: live, force: true })
})

test("Retry: a cycle stuck with no live run is an unforced retry target", () => {
  const stuck = cycle({
    runs: [
      {
        id: "run-1",
        status: "failed",
        error: "boom",
        headSha: "sha-1",
        startedAt: null,
        finishedAt: "t",
        claimedByHostId: null,
        heartbeatAt: null,
        createdAt: "t",
      },
    ],
  })

  assert.deepEqual(findReviewRetryTarget([stuck]), {
    cycle: stuck,
    force: false,
  })
})

test("Retry: a spent attempt budget is not a retry target, live run or not", () => {
  const attempt = (id: string, attemptNumber: number) => ({
    id,
    attemptNumber,
    verdict: "changes_requested",
    summary: null,
    githubReviewId: null,
    publishedAt: null,
    createdAt: "t",
    findings: [],
  })
  const exhaustedBudget = cycle({
    attempts: [attempt("a1", 1), attempt("a2", 2), attempt("a3", 3)],
    runs: [
      {
        id: "run-4",
        status: "running",
        error: null,
        headSha: "sha-1",
        startedAt: "t",
        finishedAt: null,
        claimedByHostId: "host-1",
        heartbeatAt: "t",
        createdAt: "t",
      },
    ],
  })

  assert.equal(findReviewRetryTarget([exhaustedBudget]), null)
})

test("Retry: a concluded cycle is never a retry target", () => {
  assert.equal(findReviewRetryTarget([cycle({ state: "approved" })]), null)
  assert.equal(findReviewRetryTarget([cycle({ state: "exhausted" })]), null)
  assert.equal(findReviewRetryTarget([cycle({ state: "superseded" })]), null)
})

test("Continue with human review: an active cycle counts even with no runs yet", () => {
  assert.equal(
    hasReviewRecoveryControls([cycle({ state: "active" })], null),
    true
  )
})

test("Stale-control guard: approved, exhausted, and superseded cycles show nothing on their own", () => {
  assert.equal(
    hasReviewRecoveryControls(
      [
        cycle({ id: "c1", state: "approved" }),
        cycle({ id: "c2", state: "exhausted" }),
        cycle({
          id: "c3",
          state: "superseded",
          supersededReason: "new_head_sha",
        }),
      ],
      null
    ),
    false
  )
})

test("Fresh implementation session: shown only when the owner is unresumable", () => {
  assert.equal(hasReviewRecoveryControls([], owner({ resumable: true })), false)
  assert.equal(
    hasReviewRecoveryControls(
      [],
      owner({ resumable: false, unavailableReason: "host_banned" })
    ),
    true
  )
})
