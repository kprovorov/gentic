import type { useSupabaseClient as RealClient } from "@gentic/supabase/client"
// Only imported by the disposable capture copy. No backend operation is allowed.
export function useSupabaseClient(): ReturnType<typeof RealClient> {
  return new Proxy({} as ReturnType<typeof RealClient>, {
    get() {
      throw new Error("Backend operations are disabled in screenshot fixtures")
    },
  })
}
