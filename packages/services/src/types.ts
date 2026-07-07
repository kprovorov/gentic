import type { createServiceClient } from "@gentic/supabase/service"

/**
 * Both the secret-key client and the Clerk-session-scoped client (from
 * `@gentic/supabase/server`) resolve to this same untyped shape, so service
 * functions accept either interchangeably.
 */
export type Supabase = ReturnType<typeof createServiceClient>
