"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient, type QueryKey } from "@tanstack/react-query"

import { useSupabaseClient } from "@gentic/supabase/client"

import {
  getRealtimeRefreshMode,
  realtimeFallbackRefreshMs,
  shouldUseRealtimeFallback,
  type RealtimeSubscribeStatus,
} from "./realtime-refresh-mode"

/**
 * Subscribes to Postgres changes on the given tables (already scoped by RLS
 * to rows the current user can see) and refreshes the narrowest cache that
 * owns the data. Query-backed views invalidate React Query only; views without
 * a query key fall back to refreshing the current route payload.
 */
export function RealtimeRefresh({
  channelName,
  tables,
  queryKey,
}: {
  channelName: string
  tables: string[]
  queryKey?: QueryKey
}) {
  const supabase = useSupabaseClient()
  const router = useRouter()
  const queryClient = useQueryClient()
  const tableKey = tables.join(",")
  // queryKey is often built inline (e.g. queryKeys.issue(id)), which produces
  // a new array reference every render. Read the latest value through a ref
  // so the effect below doesn't tear down and resubscribe the channel (and
  // risk dropping events) on every unrelated re-render.
  const queryKeyRef = useRef(queryKey)
  useEffect(() => {
    queryKeyRef.current = queryKey
  })

  useEffect(() => {
    let cancelled = false
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    let fallbackTimer: ReturnType<typeof setInterval> | null = null
    let subscribeStatus: RealtimeSubscribeStatus | null = null
    function scheduleRefresh() {
      if (refreshTimer) {
        clearTimeout(refreshTimer)
      }
      refreshTimer = setTimeout(() => {
        const queryKey = queryKeyRef.current
        if (getRealtimeRefreshMode(queryKey) === "invalidate-query") {
          void queryClient.invalidateQueries({ queryKey })
          return
        }
        router.refresh()
      }, 150)
    }

    function updateFallbackPolling() {
      if (shouldUseRealtimeFallback(subscribeStatus)) {
        if (!fallbackTimer) {
          fallbackTimer = setInterval(
            scheduleRefresh,
            realtimeFallbackRefreshMs
          )
        }
        return
      }

      if (fallbackTimer) {
        clearInterval(fallbackTimer)
        fallbackTimer = null
      }
    }

    function reconcile() {
      scheduleRefresh()
    }

    async function join() {
      await supabase.realtime.setAuth()
      if (cancelled) {
        return null
      }

      let channel = supabase.channel(channelName)
      for (const table of tableKey.split(",")) {
        channel = channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          scheduleRefresh
        )
      }
      channel.subscribe((status) => {
        if (
          status === "SUBSCRIBED" ||
          status === "TIMED_OUT" ||
          status === "CLOSED" ||
          status === "CHANNEL_ERROR"
        ) {
          subscribeStatus = status
          updateFallbackPolling()
        }

        if (status === "SUBSCRIBED") {
          reconcile()
        } else if (
          status === "TIMED_OUT" ||
          status === "CLOSED" ||
          status === "CHANNEL_ERROR"
        ) {
          scheduleRefresh()
        }
      })

      return channel
    }

    const channelPromise = join().catch(() => {
      subscribeStatus = "CHANNEL_ERROR"
      scheduleRefresh()
      updateFallbackPolling()
      return null
    })

    window.addEventListener("focus", reconcile)
    window.addEventListener("online", reconcile)
    document.addEventListener("visibilitychange", reconcile)
    updateFallbackPolling()

    return () => {
      cancelled = true
      if (refreshTimer) {
        clearTimeout(refreshTimer)
      }
      if (fallbackTimer) {
        clearInterval(fallbackTimer)
      }
      window.removeEventListener("focus", reconcile)
      window.removeEventListener("online", reconcile)
      document.removeEventListener("visibilitychange", reconcile)
      void channelPromise.then((channel) => {
        if (channel) {
          void supabase.removeChannel(channel)
        }
      })
    }
  }, [supabase, router, queryClient, channelName, tableKey])

  return null
}
