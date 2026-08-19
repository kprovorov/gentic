import assert from "node:assert/strict"
import test from "node:test"

import { canResetIssue } from "./issue-reset-visibility"

test("canResetIssue offers a reset once an issue has left draft", () => {
  assert.equal(canResetIssue({ status: "in-progress", type: "bug" }), true)
})

test("canResetIssue still offers a reset on a finished run", () => {
  assert.equal(canResetIssue({ status: "run-failed", type: "feature" }), true)
})

// The reset lands the issue in `todo`, so on a draft it would start the run
// rather than restart it.
test("canResetIssue hides on a draft, which has nothing to reset", () => {
  assert.equal(canResetIssue({ status: "draft", type: "feature" }), false)
})

test("canResetIssue hides on a Spec, which never runs an agent", () => {
  assert.equal(canResetIssue({ status: "in-progress", type: "spec" }), false)
})
