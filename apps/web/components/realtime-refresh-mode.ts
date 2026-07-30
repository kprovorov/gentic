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

function normalizeLayoutSegment(segment: string) {
  return segment.replace(/^(\([^)]*\))+/, "")
}

function hasDeferredModalRoute(modalSegments: readonly string[]) {
  const normalizedSegments = modalSegments.map(normalizeLayoutSegment)

  return Array.from(routeRefreshDeferredModalSegments).some((route) => {
    const routeSegments = route.split("/")
    if (normalizedSegments.length < routeSegments.length) {
      return false
    }

    return routeSegments.every(
      (segment, index) =>
        normalizedSegments[
          normalizedSegments.length - routeSegments.length + index
        ] === segment
    )
  })
}

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
  return (
    hasDeferredModalRoute(modalSegments) ||
    (pathname ? routeRefreshDeferredPathnames.has(pathname) : false)
  )
}
