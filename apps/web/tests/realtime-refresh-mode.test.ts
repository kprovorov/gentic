import assert from "node:assert/strict"
import test from "node:test"

import {
  consumeSuppressedRealtimeTable,
  getRealtimeRefreshMode,
  markSuppressedRealtimeTable,
} from "../components/realtime-refresh-mode"

test("realtime updates invalidate React Query cache when a query key is scoped", () => {
  assert.equal(getRealtimeRefreshMode(["issues", "issue_1"]), "invalidate-query")
})

test("realtime updates refresh the route only when no query cache owns the data", () => {
  assert.equal(getRealtimeRefreshMode(undefined), "refresh-route")
})

test("suppressed realtime refreshes are consumed once per table", () => {
  const suppressedTables = new Map<string, number>()

  markSuppressedRealtimeTable(
    suppressedTables,
    { table: "issues", durationMs: 1_000 },
    1_000
  )

  assert.equal(
    consumeSuppressedRealtimeTable(suppressedTables, "issue_messages", 1_100),
    false
  )
  assert.equal(
    consumeSuppressedRealtimeTable(suppressedTables, "issues", 1_100),
    true
  )
  assert.equal(
    consumeSuppressedRealtimeTable(suppressedTables, "issues", 1_100),
    false
  )
})

test("expired realtime refresh suppression does not hide later updates", () => {
  const suppressedTables = new Map<string, number>()

  markSuppressedRealtimeTable(
    suppressedTables,
    { table: "issues", durationMs: 1_000 },
    1_000
  )

  assert.equal(
    consumeSuppressedRealtimeTable(suppressedTables, "issues", 2_001),
    false
  )
})
