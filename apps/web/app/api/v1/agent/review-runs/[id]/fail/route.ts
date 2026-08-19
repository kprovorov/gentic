import { failReviewRun } from "@gentic/services/review-lifecycle"
import { failReviewRunInputSchema } from "@gentic/validators/agent"

import {
  ensureActiveReviewRunClaim,
  getAgentContext,
  handleAgentError,
  json,
} from "../../../_lib"

export const runtime = "nodejs"

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { supabase, userId, workerId } = await getAgentContext(request)
    await ensureActiveReviewRunClaim(supabase, userId, workerId, id)

    const fields = failReviewRunInputSchema.parse(await request.json())
    const result = await failReviewRun(supabase, {
      reviewRunId: id,
      error: fields.error,
    })

    return json({ retried: result.retried })
  } catch (error) {
    return handleAgentError(error)
  }
}
