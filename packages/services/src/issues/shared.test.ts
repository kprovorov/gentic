import assert from "node:assert/strict"
import { test } from "node:test"

import { kickoffMessageContent } from "./shared"

test("kickoffMessageContent preserves an existing prompt", () => {
  assert.equal(kickoffMessageContent("Ship it"), "Ship it")
})

test("kickoffMessageContent maps a missing prompt to an empty message", () => {
  assert.equal(kickoffMessageContent(null), "")
})
