import { ServiceError } from "@gentic/services/errors"
import { SkillAuditGateError } from "@gentic/services/skills"
import { z } from "zod"

import { getOptionalAuthenticatedServiceContext } from "@/app/_lib/auth-context"

export const skillsNoStoreHeaders = {
  "Cache-Control": "private, no-store",
} as const

type AuthenticatedContext = NonNullable<
  Awaited<ReturnType<typeof getOptionalAuthenticatedServiceContext>>
>

export type SkillsRouteInput = {
  context: AuthenticatedContext
  request: Request
}

/**
 * Wraps a skill route in the same authenticate-then-authorize shape the worker
 * management routes use: the service client bypasses RLS, so every handler
 * scopes its own reads and writes to `context.userId`.
 */
export function skillsRoute<T>(
  handle: (input: SkillsRouteInput) => Promise<T>,
  deps: {
    getContext?: typeof getOptionalAuthenticatedServiceContext
  } = {}
) {
  const getContext = deps.getContext ?? getOptionalAuthenticatedServiceContext

  return async function handler(request: Request) {
    const context = await getContext()
    if (!context) {
      return Response.json(
        { error: { code: "unauthorized", message: "Unauthorized" } },
        { status: 401, headers: skillsNoStoreHeaders }
      )
    }

    try {
      return Response.json(await handle({ context, request }), {
        headers: skillsNoStoreHeaders,
      })
    } catch (error) {
      return handleSkillsRouteError(error)
    }
  }
}

const statusByCode: Record<ServiceError["code"], number> = {
  not_found: 404,
  validation: 400,
  conflict: 409,
  rate_limited: 429,
  forbidden: 403,
  internal: 500,
}

function handleSkillsRouteError(error: unknown): Response {
  // The gate travels with the refusal so the dialog can re-render the audit
  // panel the user has to act on instead of only showing a message.
  if (error instanceof SkillAuditGateError) {
    return Response.json(
      {
        error: { code: "audit_gate", message: error.message },
        gate: error.gate,
      },
      { status: 409, headers: skillsNoStoreHeaders }
    )
  }

  if (error instanceof ServiceError) {
    if (error.code === "internal") {
      console.error("[skills-api] request failed:", error)
    }
    return Response.json(
      { error: { code: error.code, message: error.message } },
      { status: statusByCode[error.code], headers: skillsNoStoreHeaders }
    )
  }

  if (error instanceof SyntaxError || error instanceof z.ZodError) {
    return Response.json(
      { error: { code: "validation", message: "Invalid request" } },
      { status: 400, headers: skillsNoStoreHeaders }
    )
  }

  console.error("[skills-api] request failed:", error)
  return Response.json(
    { error: { code: "internal", message: "Unable to install skill" } },
    { status: 500, headers: skillsNoStoreHeaders }
  )
}
