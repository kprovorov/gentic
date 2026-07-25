import assert from "node:assert/strict"
import test from "node:test"

import { slugifyIssueTitle } from "./slug"

test("slugifyIssueTitle converts a normal title", () => {
  assert.equal(
    slugifyIssueTitle("Update the Login Modal!! (v2)"),
    "update-the-login-modal-v2"
  )
})

test("slugifyIssueTitle collapses whitespace and punctuation runs", () => {
  assert.equal(
    slugifyIssueTitle("  Fix   double--spacing,,, & punctuation!!!  "),
    "fix-double-spacing-punctuation"
  )
})

test("slugifyIssueTitle returns null for titles with only special characters", () => {
  assert.equal(slugifyIssueTitle("!!! --- ???"), null)
})

test("slugifyIssueTitle truncates long titles to a word boundary near 60 chars", () => {
  const title =
    "This is a very long issue title that definitely exceeds the sixty character limit we impose on slugs"
  const slug = slugifyIssueTitle(title)

  assert.ok(slug !== null)
  assert.ok(slug!.length <= 60)
  assert.equal(
    slug,
    "this-is-a-very-long-issue-title-that-definitely-exceeds-the"
  )
})

test("slugifyIssueTitle truncates a single long word without leaving a trailing dash", () => {
  const title = "a".repeat(70)
  const slug = slugifyIssueTitle(title)

  assert.equal(slug, "a".repeat(60))
})

test("slugifyIssueTitle returns null for empty and null titles", () => {
  assert.equal(slugifyIssueTitle(""), null)
  assert.equal(slugifyIssueTitle(null), null)
  assert.equal(slugifyIssueTitle(undefined), null)
})
