import { formatReviewFixRequestMessage } from "@gentic/services/issues"
import { getReviewRunPublishContext } from "@gentic/services/review-context"
import {
  completeReviewAttempt,
  deliverReviewFixRequest as defaultDeliverReviewFixRequest,
  shouldDeliverReviewFix,
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

export type CompleteReviewRunDeps = {
  deliverReviewFixRequest: typeof defaultDeliverReviewFixRequest
}

const defaultDeps: CompleteReviewRunDeps = {
  deliverReviewFixRequest: defaultDeliverReviewFixRequest,
}

// Publishes the validated verdict to GitHub as a real PR review (GEN-416)
// before recording it — `publishReviewVerdict` is the only place with GitHub
// App credentials, since the isolated reviewer runtime (ADR-0006) is
// deliberately denied them. `githubReviewId` always comes from that publish
// call, never from the request body: the host has no way to produce one
// itself, and trusting a client-supplied id here would let a request forge
// `review_attempts.github_review_id` (the exact value the webhook's
// bot-echo recognition trusts).
//
// When the recorded verdict is `changes_requested` and the cycle is still
// `active` (not exhausted at the third attempt), also returns the findings
// to the original implementation session (GEN-417, ADR-0007) —
// `deliverReviewFixRequest` itself decides whether the current durable
// owner can actually be resumed, and is a no-op if this run's delivery was
// already applied.
export async function completeReviewRun(
  supabase: Supabase,
  userId: string,
  reviewRunId: string,
  fields: CompleteReviewRunInput,
  deps: CompleteReviewRunDeps = defaultDeps
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

  const result = await completeReviewAttempt(supabase, {
    reviewRunId,
    verdict: fields.verdict,
    summary: fields.summary,
    githubReviewId: published.githubReviewId,
    findings: published.findings,
  })

  if (shouldDeliverReviewFix(result, fields.verdict)) {
    await deps.deliverReviewFixRequest(supabase, {
      reviewAttemptId: result.reviewAttemptId,
      content: formatReviewFixRequestMessage({
        prUrl: publishContext.prUrl,
        attemptNumber: result.attemptNumber ?? 1,
        summary: fields.summary ?? null,
        findings: published.findings,
      }),
    })
  }

  return result
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { supabase, userId, hostId } = await getAgentContext(request)
    await ensureActiveReviewRunClaim(supabase, userId, hostId, id)

    const fields = completeReviewRunInputSchema.parse(await request.json())
    const result = await completeReviewRun(supabase, userId, id, fields)

    return json(result)
  } catch (error) {
    return handleAgentError(error)
  }
}
