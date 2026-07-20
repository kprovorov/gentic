import { auth } from "@clerk/nextjs/server"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"

import type { Database } from "./types"

/**
 * Supabase client for use in Server Components, Route Handlers, and Server
 * Actions. Authenticates against Supabase's Data API using the current
 * Clerk session token, so RLS policies see the Clerk user.
 */
export async function createClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      async accessToken() {
        return (await auth()).getToken()
      },
    },
  )
}
