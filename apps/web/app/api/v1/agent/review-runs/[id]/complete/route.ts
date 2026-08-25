import { getReviewRunPublishContext } from "@gentic/services/review-context"
import {
  completeReviewAttempt,
  type CompleteReviewAttemptResult,
} from "@gentic/services/review-lifecycle"
import type { Supabase } from "@gentic/services/types"
import {
  completeReviewRunInputSchema,
  type CompleteReviewRunInput,
} from "@gentic/validators/agent"

import { publishReviewVerdict } from "@/lib/review-publishing"

import {
  ensureActiveReviewRunClaim,
  getAgentContext,
  handleAgentError,
  json,
} from "../../../_lib"

export const runtime = "nodejs"

// Publishes the validated verdict to GitHub as a real PR review (GEN-416)
// before recording it — `publishReviewVerdict` is the only place with GitHub
// App credentials, since the isolated reviewer runtime (ADR-0006) is
// deliberately denied them. `githubReviewId` always comes from that publish
// call, never from the request body: the worker has no way to produce one
// itself, and trusting a client-supplied id here would let a request forge
// `review_attempts.github_review_id` (the exact value the webhook's
// bot-echo recognition trusts).
export async function completeReviewRun(
  supabase: Supabase,
  userId: string,
  reviewRunId: string,
  fields: CompleteReviewRunInput
): Promise<CompleteReviewAttemptResult> {
  const publishContext = await getReviewRunPublishContext(supabase, reviewRunId)

  const published = await publishReviewVerdict(supabase, {
    reviewRunId,
    userId,
    repo: publishContext.repo,
    prUrl: publishContext.prUrl,
    expectedHeadSha: publishContext.headSha,
    verdict: fields.verdict,
    summary: fields.summary ?? null,
    findings: fields.findings ?? [],
  })

  return completeReviewAttempt(supabase, {
    reviewRunId,
    verdict: fields.verdict,
    summary: fields.summary,
    githubReviewId: published.githubReviewId,
    findings: published.findings,
  })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { supabase, userId, workerId } = await getAgentContext(request)
    await ensureActiveReviewRunClaim(supabase, userId, workerId, id)

    const fields = completeReviewRunInputSchema.parse(await request.json())
    const result = await completeReviewRun(supabase, userId, id, fields)

    return json(result)
  } catch (error) {
    return handleAgentError(error)
  }
}
