"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient, type QueryKey } from "@tanstack/react-query"

import { useSupabaseClient } from "@gentic/supabase/client"

/**
 * Subscribes to Postgres changes on the given tables (already scoped by RLS
 * to rows the current user can see) and re-runs the enclosing Server
 * Component on any change, so props stay in sync without a full page load.
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

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    function scheduleRefresh() {
      if (refreshTimer) {
        clearTimeout(refreshTimer)
      }
      refreshTimer = setTimeout(() => router.refresh(), 150)
      if (queryKey) {
        void queryClient.invalidateQueries({ queryKey })
      }
    }

    let channel = supabase.channel(channelName)
    for (const table of tableKey.split(",")) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        scheduleRefresh
      )
    }
    channel.subscribe()

    return () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer)
      }
      void supabase.removeChannel(channel)
    }
  }, [supabase, router, queryClient, channelName, tableKey, queryKey])

  return null
}
