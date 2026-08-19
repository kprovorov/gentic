import { completeReviewAttempt } from "@gentic/services/review-lifecycle"
import { completeReviewRunInputSchema } from "@gentic/validators/agent"

import {
  ensureActiveReviewRunClaim,
  getAgentContext,
  handleAgentError,
  json,
} from "../../../_lib"

export const runtime = "nodejs"

// Built for API completeness alongside claim/heartbeat/fail (GEN-414 scopes
// "completion" as an in-scope deliverable), but the worker CLI does not call
// this yet — there is no reviewer runtime to produce a verdict from. A
// future issue that adds one only needs to call this route.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { supabase, userId, workerId } = await getAgentContext(request)
    await ensureActiveReviewRunClaim(supabase, userId, workerId, id)

    const fields = completeReviewRunInputSchema.parse(await request.json())
    const result = await completeReviewAttempt(supabase, {
      reviewRunId: id,
      verdict: fields.verdict,
      summary: fields.summary,
      githubReviewId: fields.githubReviewId,
      findings: fields.findings,
    })

    return json(result)
  } catch (error) {
    return handleAgentError(error)
  }
}
