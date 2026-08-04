import { ServiceError } from "@gentic/services/errors"
import { z } from "zod"

import { getOptionalAuthenticatedServiceContext } from "@/app/_lib/auth-context"

export const workerMutationNoStoreHeaders = {
  "Cache-Control": "private, no-store",
} as const

type AuthenticatedContext = NonNullable<
  Awaited<ReturnType<typeof getOptionalAuthenticatedServiceContext>>
>

type WorkerMutationContext = {
  context: AuthenticatedContext
  params: Record<string, string>
  request: Request
}

export function workerMutationRoute<T>(
  mutate: (input: WorkerMutationContext) => Promise<T>
) {
  return async function handler(
    request: Request,
    routeContext: { params?: Promise<Record<string, string>> } = {}
  ) {
    const context = await getOptionalAuthenticatedServiceContext()
    if (!context) {
      return Response.json(
        { error: { code: "unauthorized", message: "Unauthorized" } },
        { status: 401, headers: workerMutationNoStoreHeaders }
      )
    }

    try {
      return Response.json(
        await mutate({
          context,
          params: (await routeContext.params) ?? {},
          request,
        }),
        { headers: workerMutationNoStoreHeaders }
      )
    } catch (error) {
      return handleWorkerMutationError(error)
    }
  }
}

function handleWorkerMutationError(error: unknown): Response {
  if (error instanceof ServiceError) {
    if (error.code === "internal") {
      console.error("[workers-api] request failed:", error)
    }
    const statusByCode: Record<ServiceError["code"], number> = {
      not_found: 404,
      validation: 400,
      rate_limited: 429,
      forbidden: 403,
      internal: 500,
    }
    return Response.json(
      { error: { code: error.code, message: error.message } },
      {
        status: statusByCode[error.code],
        headers: workerMutationNoStoreHeaders,
      }
    )
  }

  if (error instanceof SyntaxError || error instanceof z.ZodError) {
    return Response.json(
      { error: { code: "validation", message: "Invalid request" } },
      { status: 400, headers: workerMutationNoStoreHeaders }
    )
  }

  console.error("[workers-api] request failed:", error)
  return Response.json(
    { error: { code: "internal", message: "Unable to update worker" } },
    { status: 500, headers: workerMutationNoStoreHeaders }
  )
}
