import assert from "node:assert/strict"
import test from "node:test"

import {
  fallbackIssueType,
  issueClassificationSchema,
} from "./type-parser"

test("issueClassificationSchema accepts feature or bug", () => {
  assert.equal(
    issueClassificationSchema.parse({ type: "feature" }).type,
    "feature"
  )
  assert.equal(issueClassificationSchema.parse({ type: "bug" }).type, "bug")
})

test("issueClassificationSchema rejects placeholder and retired types", () => {
  assert.throws(() => issueClassificationSchema.parse({ type: "issue" }))
  assert.throws(() => issueClassificationSchema.parse({ type: "idea" }))
  assert.throws(() => issueClassificationSchema.parse({ type: "feedback" }))
})

test("fallbackIssueType never returns the issue placeholder", () => {
  assert.equal(fallbackIssueType("Fix the crash when saving settings"), "bug")
  assert.equal(
    fallbackIssueType("Add saved filters to the issue list"),
    "feature"
  )
})
