import assert from "node:assert/strict"
import test from "node:test"

import { canShowManualCreatePrAction } from "./manual-create-pr-visibility"

test("canShowManualCreatePrAction shows after a finished idle run with unpublished changes and no PR", () => {
  assert.equal(
    canShowManualCreatePrAction({
      status: "ready-for-review",
      hasUnpublishedAgentChanges: true,
      hasAttachedPullRequest: false,
      automaticPublishingInProgress: false,
    }),
    true
  )
})

test("canShowManualCreatePrAction hides while automatic publishing is still running", () => {
  assert.equal(
    canShowManualCreatePrAction({
      status: "ready-for-review",
      hasUnpublishedAgentChanges: true,
      hasAttachedPullRequest: false,
      automaticPublishingInProgress: true,
    }),
    false
  )
})

test("canShowManualCreatePrAction hides once any PR is attached", () => {
  assert.equal(
    canShowManualCreatePrAction({
      status: "ready-for-review",
      hasUnpublishedAgentChanges: true,
      hasAttachedPullRequest: true,
      automaticPublishingInProgress: false,
    }),
    false
  )
})

test("canShowManualCreatePrAction allows recovery after automatic publishing ended without a PR", () => {
  assert.equal(
    canShowManualCreatePrAction({
      status: "run-failed",
      hasUnpublishedAgentChanges: true,
      hasAttachedPullRequest: false,
      automaticPublishingInProgress: false,
    }),
    true
  )
})
