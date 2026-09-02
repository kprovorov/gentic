import assert from "node:assert/strict"
import test from "node:test"

import { canMergePullRequest } from "./merge-pull-request-visibility"

test("canMergePullRequest offers the merge for an approved open pull request", () => {
  assert.equal(
    canMergePullRequest({
      state: "open",
      ci_state: "success",
      review_decision: "approved",
    }),
    true
  )
})

test("canMergePullRequest offers the merge while checks are still pending", () => {
  assert.equal(
    canMergePullRequest({
      state: "open",
      ci_state: "pending",
      review_decision: "approved",
    }),
    true
  )
})

test("canMergePullRequest withholds the merge when CI failed", () => {
  assert.equal(
    canMergePullRequest({
      state: "open",
      ci_state: "failure",
      review_decision: "approved",
    }),
    false
  )
})

test("canMergePullRequest withholds the merge without an approval", () => {
  for (const reviewDecision of [
    "unknown",
    "review_required",
    "changes_requested",
  ]) {
    assert.equal(
      canMergePullRequest({
        state: "open",
        ci_state: "success",
        review_decision: reviewDecision,
      }),
      false,
      reviewDecision
    )
  }
})

test("canMergePullRequest withholds the merge for any non-open state", () => {
  for (const state of ["draft", "merged", "closed", "queued"] as const) {
    assert.equal(
      canMergePullRequest({
        state,
        ci_state: "success",
        review_decision: "approved",
      }),
      false,
      state
    )
  }
})

// `attachPullRequestStates` narrows the persisted `"unknown"` to `undefined`
// before the rail ever sees it, so this is what an un-hydrated PR looks like.
test("canMergePullRequest withholds the merge for a pull request with no known state", () => {
  assert.equal(
    canMergePullRequest({
      state: undefined,
      ci_state: "success",
      review_decision: "approved",
    }),
    false
  )
})
