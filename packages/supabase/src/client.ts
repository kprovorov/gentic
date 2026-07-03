"use client"

import { useMemo } from "react"
import { useSession } from "@clerk/nextjs"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"

/**
 * Supabase client for use in Client Components. Authenticates against
 * Supabase's Data API using the Clerk session token (Clerk is registered as a
 * Supabase Third-Party Auth provider), so RLS policies see the Clerk user.
 */
export function useSupabaseClient() {
  const { session } = useSession()

  return useMemo(
    () =>
      createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        {
          async accessToken() {
            return (await session?.getToken()) ?? null
          },
        },
      ),
    [session],
  )
}
