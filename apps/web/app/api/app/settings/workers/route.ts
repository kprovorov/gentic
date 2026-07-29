import { getOptionalAuthenticatedContext } from "@/app/_lib/auth-context"
import { getSettingsWorkersData, QueryNotFoundError } from "@/app/queries"

import { createJsonQueryHandler } from "../../api-query-route"

type AuthenticatedContext = NonNullable<
  Awaited<ReturnType<typeof getOptionalAuthenticatedContext>>
>

export function createSettingsWorkersRoute(deps: {
  getContext?: typeof getOptionalAuthenticatedContext
  read?: (context: AuthenticatedContext) => Promise<unknown>
} = {}) {
  return createJsonQueryHandler(
    ({ context }) => (deps.read ?? getSettingsWorkersData)(context),
    {
      getContext: deps.getContext ?? getOptionalAuthenticatedContext,
      isNotFoundError: (error) => error instanceof QueryNotFoundError,
      logError: console.error,
    }
  )
}

export const GET = createSettingsWorkersRoute()
