import assert from "node:assert/strict"
import test from "node:test"

import {
  getRealtimeRefreshMode,
  shouldDeferRouteRefresh,
  shouldUseRealtimeFallback,
} from "../components/realtime-refresh-mode"

test("realtime updates invalidate React Query cache when a query key is scoped", () => {
  assert.equal(
    getRealtimeRefreshMode(["issues", "issue_1"]),
    "invalidate-query"
  )
})

test("realtime updates refresh the route only when no query cache owns the data", () => {
  assert.equal(getRealtimeRefreshMode(undefined), "refresh-route")
})

test("realtime fallback polling runs until the channel is subscribed", () => {
  assert.equal(shouldUseRealtimeFallback(null), true)
  assert.equal(shouldUseRealtimeFallback("TIMED_OUT"), true)
  assert.equal(shouldUseRealtimeFallback("CHANNEL_ERROR"), true)
  assert.equal(shouldUseRealtimeFallback("CLOSED"), true)
  assert.equal(shouldUseRealtimeFallback("SUBSCRIBED"), false)
})

test("route refreshes defer while the new issue modal route is active", () => {
  assert.equal(shouldDeferRouteRefresh({ pathname: "/issues/new" }), true)
  assert.equal(shouldDeferRouteRefresh({ pathname: "/issues" }), false)
  assert.equal(shouldDeferRouteRefresh({ pathname: "/issues/WEB-123" }), false)
  assert.equal(shouldDeferRouteRefresh({ pathname: null }), false)
})

test("route refreshes defer when issue detail is behind the new issue modal slot", () => {
  assert.equal(
    shouldDeferRouteRefresh({
      pathname: "/issues/WEB-123",
      modalSegments: ["issues", "new"],
    }),
    true
  )
})
