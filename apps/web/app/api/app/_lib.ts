import { getOptionalAuthenticatedContext } from "@/app/_lib/auth-context"
import { QueryNotFoundError } from "@/app/queries"

import { createJsonQueryHandler } from "./api-query-route"

type AuthenticatedContext = NonNullable<
  Awaited<ReturnType<typeof getOptionalAuthenticatedContext>>
>

export function jsonQueryRoute<T>(
  read: (input: {
    context: AuthenticatedContext
    params: Record<string, string>
  }) => Promise<T>
) {
  return createJsonQueryHandler(read, {
    getContext: getOptionalAuthenticatedContext,
    isNotFoundError: (error) => error instanceof QueryNotFoundError,
    logError: console.error,
  })
}
