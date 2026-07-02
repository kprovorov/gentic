import { createBrowserClient } from "@supabase/ssr"

/**
 * Supabase client for use in Client Components (runs in the browser).
 * Safe to call on every render — it memoizes a single instance internally.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  )
}
