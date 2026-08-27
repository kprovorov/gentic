"use client"

import { useEffect, useMemo, useRef } from "react"
import { useSession } from "@clerk/nextjs"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"

import type { Database } from "./types"

/**
 * Supabase client for use in Client Components. Authenticates against
 * Supabase's Data API using the Clerk session token (Clerk is registered as a
 * Supabase Third-Party Auth provider), so RLS policies see the Clerk user.
 *
 * The returned client is stable for the lifetime of the calling component.
 * Clerk hands back a *new* session object every time it touches the session
 * (roughly once a minute while the tab is open), so keying the client off
 * `session` rebuilt it — and tore down its WebSocket — on that same cadence,
 * which surfaced to users as a Realtime connection that kept dropping and
 * reconnecting. Only the token needs to be current, and `accessToken` is
 * called lazily, so read the session through a ref instead.
 */
export function useSupabaseClient() {
  const { session } = useSession()
  const sessionRef = useRef(session)
  useEffect(() => {
    sessionRef.current = session
  })

  return useMemo(
    () =>
      createSupabaseClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        {
          async accessToken() {
            return (await sessionRef.current?.getToken()) ?? null
          },
        },
      ),
    [],
  )
}
