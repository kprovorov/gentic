import { ServiceError } from "@gentic/services/errors"
import { createWorkerEnrollmentCode } from "@gentic/services/workers"

import { getOptionalAuthenticatedContext } from "@/app/_lib/auth-context"

export const runtime = "nodejs"

export const POST = createWorkerEnrollmentCodeHandler({
  getContext: getOptionalAuthenticatedContext,
  createCode: createWorkerEnrollmentCode,
})

export function createWorkerEnrollmentCodeHandler(deps: {
  getContext: typeof getOptionalAuthenticatedContext
  createCode: typeof createWorkerEnrollmentCode
}) {
  return async function POST() {
    const context = await deps.getContext()
    if (!context) {
      return Response.json(
        { error: { code: "unauthorized", message: "Unauthorized" } },
        { status: 401 }
      )
    }

    try {
      const code = await deps.createCode(context.supabase, context.userId)

      return Response.json(code)
    } catch (error) {
      if (error instanceof ServiceError) {
        return Response.json(
          { error: error.message },
          { status: error.code === "validation" ? 400 : 500 }
        )
      }
      throw error
    }
  }
}
