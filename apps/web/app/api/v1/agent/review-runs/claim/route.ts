import { claimReviewRun } from "@gentic/services/review-jobs"
import { failReviewRun } from "@gentic/services/review-lifecycle"
import { getWorker } from "@gentic/services/workers"
import type { WorkerCompatibilityPolicy } from "@gentic/services/workers"
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
    const { supabase, userId, workerId } = await getAgentContext(request)
    claimReviewRunInputSchema.parse(await request.json().catch(() => ({})))
    return json({
      reviewRun: await claimNextReviewRun(supabase, userId, workerId),
    })
  } catch (error) {
    return handleAgentError(error)
  }
}

// Implementation issues and review runs share one capacity pool per worker
// (`packages/services/src/workers.ts` `listRunningTaskCounts`), so the
// worker CLI enforces "implementation claimed first" simply by calling
// `claimNextQueuedIssue` before this route on every poll tick: whichever job
// class claims first consumes the slot this capacity check sees.
export async function claimNextReviewRun(
  supabase: Supabase,
  userId: string,
  workerId: string,
  options: { compatibilityPolicy?: WorkerCompatibilityPolicy } = {}
) {
  const worker = await getWorker(supabase, userId, workerId, {
    compatibilityPolicy: options.compatibilityPolicy,
  })
  if (worker.primary_state !== "online") {
    return null
  }
  if (worker.version_health === "unsupported") {
    return null
  }
  if (worker.running_task_count >= worker.configured_capacity) {
    return null
  }

  const claimed = await claimReviewRun(supabase, workerId, userId)
  if (!claimed) {
    return null
  }

  const freshWorker = await getWorker(supabase, userId, workerId, {
    compatibilityPolicy: options.compatibilityPolicy,
  })
  if (
    freshWorker.primary_state !== "online" ||
    freshWorker.version_health === "unsupported"
  ) {
    // No lease to roll back (`claimed_by_worker_id` is a permanent audit
    // field, not a release-on-rollback lease) — reuse the infra-failure path
    // instead, which also gets the free automatic retry.
    await failReviewRun(supabase, {
      reviewRunId: claimed.reviewRunId,
      error: "Worker became ineligible immediately after claim",
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
