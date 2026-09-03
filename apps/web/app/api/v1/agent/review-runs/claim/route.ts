import { claimReviewRun } from "@gentic/services/review-jobs"
import { failReviewRun } from "@gentic/services/review-lifecycle"
import { getHost } from "@gentic/services/hosts"
import type { HostCompatibilityPolicy } from "@gentic/services/hosts"
import { claimReviewRunInputSchema } from "@gentic/validators/agent"

import {
  getAgentContext,
  handleAgentError,
  json,
  type Supabase,
} from "../../_lib"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const { supabase, userId, hostId } = await getAgentContext(request)
    claimReviewRunInputSchema.parse(await request.json().catch(() => ({})))
    return json({
      reviewRun: await claimNextReviewRun(supabase, userId, hostId),
    })
  } catch (error) {
    return handleAgentError(error)
  }
}

// Implementation issues and review runs share one capacity pool per host
// (`packages/services/src/hosts.ts` `listRunningTaskCounts`), so the
// host CLI enforces "implementation claimed first" simply by calling
// `claimNextQueuedIssue` before this route on every poll tick: whichever job
// class claims first consumes the slot this capacity check sees.
export async function claimNextReviewRun(
  supabase: Supabase,
  userId: string,
  hostId: string,
  options: { compatibilityPolicy?: HostCompatibilityPolicy } = {}
) {
  const host = await getHost(supabase, userId, hostId, {
    compatibilityPolicy: options.compatibilityPolicy,
  })
  if (host.primary_state !== "online") {
    return null
  }
  if (host.version_health === "unsupported") {
    return null
  }
  if (host.running_task_count >= host.configured_capacity) {
    return null
  }

  const claimed = await claimReviewRun(supabase, hostId, userId)
  if (!claimed) {
    return null
  }

  const freshHost = await getHost(supabase, userId, hostId, {
    compatibilityPolicy: options.compatibilityPolicy,
  })
  if (
    freshHost.primary_state !== "online" ||
    freshHost.version_health === "unsupported"
  ) {
    // No lease to roll back (`claimed_by_host_id` is a permanent audit
    // field, not a release-on-rollback lease) — reuse the infra-failure path
    // instead, which also gets the free automatic retry.
    await failReviewRun(supabase, {
      reviewRunId: claimed.reviewRunId,
      error: "Host became ineligible immediately after claim",
    })
    return null
  }

  return {
    id: claimed.reviewRunId,
    reviewCycleId: claimed.reviewCycleId,
    issueId: claimed.issueId,
    pullRequestId: claimed.pullRequestId,
    headSha: claimed.headSha,
  }
}
