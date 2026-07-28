import assert from "node:assert/strict"
import test from "node:test"

import { fallbackIssueType, parseGeneratedIssueType } from "./type-parser"

test("parseGeneratedIssueType accepts feature or bug from model text", () => {
  assert.equal(parseGeneratedIssueType("feature"), "feature")
  assert.equal(parseGeneratedIssueType("Bug."), "bug")
  assert.equal(parseGeneratedIssueType("This is a bug."), "bug")
})

test("parseGeneratedIssueType rejects placeholder and retired types", () => {
  assert.equal(parseGeneratedIssueType("issue"), null)
  assert.equal(parseGeneratedIssueType("idea"), null)
  assert.equal(parseGeneratedIssueType("feedback"), null)
})

test("fallbackIssueType never returns the issue placeholder", () => {
  assert.equal(fallbackIssueType("Fix the crash when saving settings"), "bug")
  assert.equal(
    fallbackIssueType("Add saved filters to the issue list"),
    "feature"
  )
})
