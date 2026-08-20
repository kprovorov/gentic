import { getGithubIntegration } from "@gentic/services/github-integrations"
import { getReviewRunContext } from "@gentic/services/review-context"
import type { Supabase } from "@gentic/services/types"
import { reviewRunContextResponseSchema } from "@gentic/validators/agent"

import { fetchPullRequestMetadata } from "@/lib/github-app"
import { parsePullNumber } from "@/lib/ci-status"

import {
  ensureActiveReviewRunClaim,
  getAgentContext,
  handleAgentError,
  json,
} from "../../../_lib"

export const runtime = "nodejs"

// Everything the isolated reviewer process (GEN-415) is given: original
// Issue title/body/attachments, repository (its own CLAUDE.md/AGENTS.md is
// picked up by the agent itself once it's running in the disposable
// checkout, so it never needs to travel through this payload), additive
// Project reviewer instructions, pull-request metadata, and CI evidence for
// the exact head SHA. The diff itself is computed locally by the worker
// against the disposable checkout, not fetched here.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { supabase, userId, workerId } = await getAgentContext(request)
    await ensureActiveReviewRunClaim(supabase, userId, workerId, id)

    const context = await getReviewRunContext(supabase, id)
    const pullRequestMetadata = await resolvePullRequestMetadata(
      supabase,
      userId,
      context.repo,
      context.pullRequest.url
    )

    return json(
      reviewRunContextResponseSchema.parse({
        issue: context.issue,
        attachments: context.attachments,
        repo: context.repo,
        reviewerProvider: context.reviewerProvider,
        reviewerModel: context.reviewerModel,
        reviewerInstructions: context.reviewerInstructions,
        pullRequest: {
          url: context.pullRequest.url,
          headSha: context.pullRequest.headSha,
          ciState: context.pullRequest.ciState,
          ...pullRequestMetadata,
        },
      })
    )
  } catch (error) {
    return handleAgentError(error)
  }
}

// The PR's own title/body/base ref live on GitHub, not in this database.
// Mirrors `resolvePrFinishStatus` (`apps/web/lib/ci-status.ts`): any lookup
// failure (no integration, no installation, a GitHub API error) degrades to
// nulls rather than turning a transient GitHub hiccup into a review-blocking
// infrastructure failure — the reviewer still has the issue, the diff, and
// the CI/head-SHA evidence from the database either way.
export async function resolvePullRequestMetadata(
  supabase: Supabase,
  userId: string,
  repo: string,
  prUrl: string
): Promise<{
  title: string | null
  body: string | null
  baseRef: string | null
  baseSha: string | null
}> {
  const empty = { title: null, body: null, baseRef: null, baseSha: null }
  const pullNumber = parsePullNumber(prUrl)
  const [owner, name] = repo.split("/")

  if (!pullNumber || !owner || !name) {
    return empty
  }

  try {
    const integration = await getGithubIntegration(supabase, userId)
    if (!integration?.installation_id) {
      return empty
    }

    return await fetchPullRequestMetadata(
      integration.installation_id,
      owner,
      name,
      pullNumber
    )
  } catch (error) {
    console.error(
      "[review-run-context] failed to fetch pull request metadata:",
      error
    )
    return empty
  }
}
