import { createClient as createSupabaseClient } from "@supabase/supabase-js"

import type { Database } from "./types"

/**
 * Secret-key Supabase client for trusted server-side code. It bypasses RLS,
 * so callers must authenticate and authorize every request before querying.
 *
 * Intentionally free of any `next` imports so plain Node/server code can use it.
 */
export function createServiceClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY

  if (!url) {
    throw new Error("SUPABASE_URL is not set")
  }

  if (!secretKey) {
    throw new Error("SUPABASE_SECRET_KEY is not set")
  }

  return createSupabaseClient<Database>(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
