import assert from "node:assert/strict"
import test from "node:test"

import { getRealtimeRefreshMode } from "../components/realtime-refresh-mode"

test("realtime updates invalidate React Query cache when a query key is scoped", () => {
  assert.equal(getRealtimeRefreshMode(["issues", "issue_1"]), "invalidate-query")
})

test("realtime updates refresh the route only when no query cache owns the data", () => {
  assert.equal(getRealtimeRefreshMode(undefined), "refresh-route")
})
