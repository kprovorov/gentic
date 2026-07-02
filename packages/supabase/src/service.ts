import { createClient as createSupabaseClient } from "@supabase/supabase-js"

/**
 * Service-role Supabase client for trusted server-side processes (e.g. the
 * `@gentic/gentic` agent) that run outside a user request. It bypasses RLS, so
 * it must only ever run somewhere the service-role key can be kept secret.
 *
 * Intentionally free of any `next` imports so plain Node processes can use it.
 */
export function createServiceClient() {
  const url = process.env.SUPABASE_URL
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
