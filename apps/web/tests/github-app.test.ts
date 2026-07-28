import assert from "node:assert/strict"
import test from "node:test"

import {
  isRelevantCheckSuite,
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
