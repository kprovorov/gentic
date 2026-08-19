import { unwrap } from "./errors"
import type { Supabase } from "./types"

// Worker-facing claim layer on top of the Automatic Review lifecycle engine
// (GEN-414, see ADR-0005 in docs/adr/). A thin wrapper over the
// `claim_review_run` RPC, which atomically claims the next eligible pending
// `review_runs` row for a worker (`for update ... skip locked`, so two
// workers can never win the same row). Called from the agent API's
// review-run claim route (trusted server code, worker-credential
// authenticated).

export type ClaimedReviewRun = {
  reviewRunId: string
  reviewCycleId: string
  issueId: string
  pullRequestId: string
  headSha: string
}

// Returns null when there is nothing eligible for this worker/user: unknown
// or banned worker, no pending review run, or the row was won by a
// concurrent claim first.
export async function claimReviewRun(
  supabase: Supabase,
  workerId: string,
  userId: string
): Promise<ClaimedReviewRun | null> {
  const result = unwrap(
    await supabase.rpc("claim_review_run", {
      p_worker_id: workerId,
      p_user_id: userId,
    })
  )[0]

  if (!result) {
    return null
  }

  return {
    reviewRunId: result.review_run_id,
    reviewCycleId: result.review_cycle_id,
    issueId: result.issue_id,
    pullRequestId: result.pull_request_id,
    headSha: result.head_sha,
  }
}
