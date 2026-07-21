import type { QueryKey } from "@tanstack/react-query"

export type RealtimeRefreshMode = "invalidate-query" | "refresh-route"

export function getRealtimeRefreshMode(
  queryKey: QueryKey | undefined
): RealtimeRefreshMode {
  return queryKey ? "invalidate-query" : "refresh-route"
}
