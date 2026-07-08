export type ServiceErrorCode =
  "not_found" | "forbidden" | "validation" | "internal"

/**
 * Framework-agnostic error thrown by every function in `@gentic/services`.
 * Callers (Server Actions, REST routes, MCP tools) map `code` onto whatever
 * error shape they need instead of inspecting a bare `Error` message.
 */
export class ServiceError extends Error {
  readonly code: ServiceErrorCode

  constructor(code: ServiceErrorCode, message: string) {
    super(message)
    this.name = "ServiceError"
    this.code = code
  }
}

/**
 * Throws `ServiceError("internal", ...)` on a Supabase error, otherwise
 * returns `data`. Only fits calls where that's the whole story — callers
 * needing a custom check (e.g. `not_found` on null, a specific error code)
 * should keep handling their result inline.
 */
export function unwrap<T>(
  result: { data: T; error: null } | { data: null; error: { message: string } }
): T {
  if (result.error) {
    throw new ServiceError("internal", result.error.message)
  }
  return result.data
}
