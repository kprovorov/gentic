import { createClient as createSupabaseClient } from "@supabase/supabase-js"

/**
 * Service-role Supabase client for trusted server-side code. It bypasses RLS,
 * so callers must authenticate and authorize every request before querying.
 *
 * Intentionally free of any `next` imports so plain Node/server code can use it.
 */
export function createServiceClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) {
    throw new Error("SUPABASE_URL is not set")
  }

  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set")
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
