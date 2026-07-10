import assert from "node:assert/strict"
import { test } from "node:test"

import { formatToolStatus } from "./tools.js"

test("formatToolStatus reports a missing CLI", () => {
  assert.equal(
    formatToolStatus({ installed: false, authenticated: false, version: null }),
    "not installed"
  )
})

test("formatToolStatus reports an installed but unauthenticated CLI", () => {
  assert.equal(
    formatToolStatus({
      installed: true,
      authenticated: false,
      version: "1.0.0",
    }),
    "installed, not authenticated"
  )
})

test("formatToolStatus reports an installed and authenticated CLI", () => {
  assert.equal(
    formatToolStatus({
      installed: true,
      authenticated: true,
      version: "1.0.0",
    }),
    "installed, authenticated"
  )
})
