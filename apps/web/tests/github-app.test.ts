import assert from "node:assert/strict"
import test from "node:test"

import {
  isRelevantCheckSuite,
  resolvePullRequestSnapshot,
  resolvePullRequestState,
} from "../lib/github-app"

test("isRelevantCheckSuite drops suites that never ran any checks", () => {
  assert.equal(
    isRelevantCheckSuite({
      status: "queued",
      conclusion: null,
      latest_check_runs_count: 0,
    }),
    false
  )
})

test("resolvePullRequestSnapshot preserves GitHub aggregate review and CI state", () => {
  assert.deepEqual(
    resolvePullRequestSnapshot({
      state: "OPEN",
      isDraft: false,
      headRefOid: "head-42",
      reviewDecision: "CHANGES_REQUESTED",
      statusCheckRollup: { state: "FAILURE" },
    }),
    {
      state: "open",
      headSha: "head-42",
      ciState: "failure",
      reviewDecision: "changes_requested",
    }
  )
})

test("isRelevantCheckSuite keeps suites that reported a check run", () => {
  assert.equal(
    isRelevantCheckSuite({
      status: "completed",
      conclusion: "success",
      latest_check_runs_count: 1,
    }),
    true
  )
})

test("resolvePullRequestState prioritizes draft, queued, open, closed, and merged states", () => {
  assert.equal(
    resolvePullRequestState({
      state: "open",
      draft: true,
      merged: false,
      merged_at: null,
      mergeable_state: "draft",
    }),
    "draft"
  )
  assert.equal(
    resolvePullRequestState({
      state: "open",
      draft: false,
      merged: false,
      merged_at: null,
      mergeable_state: "queued",
    }),
    "queued"
  )
  assert.equal(resolvePullRequestState({ state: "open" }), "open")
  assert.equal(resolvePullRequestState({ state: "closed" }), "closed")
  assert.equal(
    resolvePullRequestState({
      state: "closed",
      merged: true,
      merged_at: "2026-07-28T00:00:00Z",
    }),
    "merged"
  )
})
