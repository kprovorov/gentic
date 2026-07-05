export type ServiceErrorCode = "not_found" | "forbidden" | "validation" | "internal"

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
