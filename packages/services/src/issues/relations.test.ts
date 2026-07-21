import assert from "node:assert/strict"
import { test } from "node:test"

import { relationEndpoints } from "./relations"

test("relationEndpoints maps blocking direction from issue to related issue", () => {
  assert.deepEqual(relationEndpoints("issue", "related", "blocking"), {
    sourceIssueId: "issue",
    targetIssueId: "related",
  })
})

test("relationEndpoints maps blocked-by direction from related issue to issue", () => {
  assert.deepEqual(relationEndpoints("issue", "related", "blocked_by"), {
    sourceIssueId: "related",
    targetIssueId: "issue",
  })
})
