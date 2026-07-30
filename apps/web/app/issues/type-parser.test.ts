import assert from "node:assert/strict"
import test from "node:test"

import { fallbackIssueType, issueMetadataSchema } from "./type-parser"

test("issueMetadataSchema accepts a title, feature or bug type, and priority", () => {
  const parsed = issueMetadataSchema.parse({
    title: "Add saved filters",
    type: "feature",
    priority: "high",
  })

  assert.equal(parsed.title, "Add saved filters")
  assert.equal(parsed.type, "feature")
  assert.equal(parsed.priority, "high")

  assert.equal(
    issueMetadataSchema.parse({
      title: "Fix crash on save",
      type: "bug",
      priority: "urgent",
    }).type,
    "bug"
  )
})

test("issueMetadataSchema rejects placeholder and retired types", () => {
  assert.throws(() =>
    issueMetadataSchema.parse({
      title: "Something",
      type: "issue",
      priority: "medium",
    })
  )
  assert.throws(() =>
    issueMetadataSchema.parse({
      title: "Something",
      type: "idea",
      priority: "medium",
    })
  )
  assert.throws(() =>
    issueMetadataSchema.parse({
      title: "Something",
      type: "feedback",
      priority: "medium",
    })
  )
})

test("issueMetadataSchema rejects invalid priority", () => {
  assert.throws(() =>
    issueMetadataSchema.parse({
      title: "Something",
      type: "bug",
      priority: "critical",
    })
  )
})

test("fallbackIssueType never returns the issue placeholder", () => {
  assert.equal(fallbackIssueType("Fix the crash when saving settings"), "bug")
  assert.equal(
    fallbackIssueType("Add saved filters to the issue list"),
    "feature"
  )
})
