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

    const code = await deps.createCode(
      context.supabase,
      context.userId
    )

    return Response.json(code)
  }
}
