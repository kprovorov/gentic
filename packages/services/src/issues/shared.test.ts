import assert from "node:assert/strict"
import test from "node:test"

import { getIssueCode, isIssueBlockerResolved } from "./shared"

test("getIssueCode joins project key and issue number", () => {
  assert.equal(getIssueCode("FIT", 45), "FIT-45")
})

test("isIssueBlockerResolved treats merged and terminal statuses as unblocking", () => {
  assert.equal(isIssueBlockerResolved("merged"), true)
  assert.equal(isIssueBlockerResolved("completed"), true)
  assert.equal(isIssueBlockerResolved("cancelled"), true)
  assert.equal(isIssueBlockerResolved("ready-for-review"), false)
  assert.equal(isIssueBlockerResolved("waiting-for-input"), false)
})
