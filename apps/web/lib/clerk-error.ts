/**
 * Clerk throws a ClerkAPIResponseError with an `errors` array; this pulls the
 * first message out for display in a toast, falling back for network errors
 * and the like that don't have that shape.
 */
export function clerkErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "errors" in error) {
    const [first] = (
      error as { errors?: { longMessage?: string; message?: string }[] }
    ).errors ?? [undefined]

    if (first?.longMessage ?? first?.message) {
      return first.longMessage ?? first.message
    }
  }

  return fallback
}
