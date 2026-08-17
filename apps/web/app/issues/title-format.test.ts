import assert from "node:assert/strict"
import { test } from "node:test"

import { formatGeneratedIssueTitle, MAX_TITLE_LENGTH } from "./title-format"

test("generated titles are shortened at a word boundary", () => {
  assert.equal(
    formatGeneratedIssueTitle(
      "In the chat show real user avatar if it exists instead of just a circle"
    ),
    "In the chat show real user avatar if it exists instead of"
  )
})

test("generated titles normalize model punctuation and whitespace", () => {
  assert.equal(
    formatGeneratedIssueTitle('  "Review   onboarding flow."  '),
    "Review onboarding flow"
  )
})

test("generated title formatter keeps a bounded single long word", () => {
  assert.equal(
    formatGeneratedIssueTitle("a".repeat(80)).length,
    MAX_TITLE_LENGTH
  )
})
