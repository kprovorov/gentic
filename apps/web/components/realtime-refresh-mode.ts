import type { QueryKey } from "@tanstack/react-query"

export type RealtimeRefreshMode = "invalidate-query" | "refresh-route"

export const SUPPRESS_NEXT_REALTIME_REFRESH_EVENT =
  "gentic:realtime-refresh:suppress-next"

export type SuppressNextRealtimeRefreshDetail = {
  table: string
  durationMs?: number
}

export function getRealtimeRefreshMode(
  queryKey: QueryKey | undefined
): RealtimeRefreshMode {
  return queryKey ? "invalidate-query" : "refresh-route"
}

export function markSuppressedRealtimeTable(
  suppressedTables: Map<string, number>,
  { table, durationMs = 5_000 }: SuppressNextRealtimeRefreshDetail,
  now = Date.now()
) {
  suppressedTables.set(table, now + durationMs)
}

export function consumeSuppressedRealtimeTable(
  suppressedTables: Map<string, number>,
  table: string,
  now = Date.now()
) {
  const expiresAt = suppressedTables.get(table)

  if (!expiresAt) {
    return false
  }

  suppressedTables.delete(table)
  return expiresAt >= now
}
