import assert from "node:assert/strict"
import test from "node:test"

import { getIssueCode } from "./shared"

test("getIssueCode joins project key and issue number", () => {
  assert.equal(getIssueCode("FIT", 45), "FIT-45")
})
