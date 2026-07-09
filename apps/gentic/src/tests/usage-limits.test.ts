import assert from "node:assert/strict"
import { test } from "node:test"

import { getUsageLimitResetAt } from "../usage-limits.js"

test("extracts relative usage-limit reset times", () => {
  assert.equal(
    getUsageLimitResetAt(
      new Error(
        "Claude Code usage limit reached. Try again in 2 hours 15 minutes."
      ),
      new Date("2026-07-09T10:00:00.000Z")
    ),
    "2026-07-09T12:15:00.000Z"
  )
})

test("extracts same-day time-only reset times", () => {
  assert.equal(
    getUsageLimitResetAt(
      new Error("Codex rate limit exceeded. Usage resets at 11:30 AM."),
      new Date("2026-07-09T10:00:00.000Z")
    ),
    "2026-07-09T11:30:00.000Z"
  )
})

test("rolls time-only reset times to tomorrow when already passed", () => {
  assert.equal(
    getUsageLimitResetAt(
      new Error("Usage limit reached; resets at 9 PM."),
      new Date("2026-07-09T22:00:00.000Z")
    ),
    "2026-07-10T21:00:00.000Z"
  )
})

test("ignores non-limit errors", () => {
  assert.equal(
    getUsageLimitResetAt(
      new Error("fatal: repository not found"),
      new Date("2026-07-09T10:00:00.000Z")
    ),
    null
  )
})
