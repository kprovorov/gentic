import type { QueryKey } from "@tanstack/react-query"

export type RealtimeRefreshMode = "invalidate-query" | "refresh-route"
export type RealtimeSubscribeStatus =
  | "SUBSCRIBED"
  | "TIMED_OUT"
  | "CLOSED"
  | "CHANNEL_ERROR"

export const realtimeFallbackRefreshMs = 10_000
const routeRefreshDeferredPathnames = new Set(["/issues/new"])
const routeRefreshDeferredModalSegments = new Set(["issues/new"])

export function getRealtimeRefreshMode(
  queryKey: QueryKey | undefined
): RealtimeRefreshMode {
  return queryKey ? "invalidate-query" : "refresh-route"
}

export function shouldUseRealtimeFallback(
  status: RealtimeSubscribeStatus | null
) {
  return status !== "SUBSCRIBED"
}

export function shouldDeferRouteRefresh(
  pathname: string | null | undefined,
  modalSegments: readonly string[] = []
) {
  const hasDeferredModalRoute =
    modalSegments.length > 0 &&
    routeRefreshDeferredModalSegments.has(modalSegments.join("/"))

  return (
    hasDeferredModalRoute ||
    (pathname ? routeRefreshDeferredPathnames.has(pathname) : false)
  )
}
