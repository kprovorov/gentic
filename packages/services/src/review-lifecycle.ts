import { ServiceError, unwrap } from "./errors"
import type { Supabase } from "./types"

// The Automatic Review lifecycle engine (GEN-413, see ADR-0004 in
// docs/adr/). These are thin wrappers over the `evaluate_review_eligibility`
// / `complete_review_attempt` / `fail_review_run` / `supersede_active_review_
// cycle` / `continue_with_human_review` RPCs, which own every transition of
// `review_cycles`/`review_runs`/`review_attempts`. Called from the GitHub
// webhook route (trusted server code, no `userId` to check ownership
// against beyond the webhook signature) except `continueWithHumanReview`,
// which is a Clerk-authenticated user action.

export type ReviewEligibilityAction =
  | "policy_disabled"
  | "noop"
  | "paused"
  | "queued"
  | "continued"
  | "superseded_and_queued"

export type ReviewEligibilityResult = {
  issueId: string
  pullRequestId: string
  eligible: boolean
  reviewCycleId: string | null
  reviewRunId: string | null
  action: ReviewEligibilityAction
}

// Re-evaluate whether a pull request should have a live automatic Review
// Attempt in flight, queueing one if so. Call after every pull_request event
// (opened, synchronize, ready_for_review, reopened, converted_to_draft) and
// every check_suite/check_run/workflow_run pending or completed event.
// Idempotent and safe to call repeatedly for the same state.
export async function evaluateReviewEligibility(
  supabase: Supabase,
  prUrl: string
): Promise<ReviewEligibilityResult | null> {
  const result = unwrap(
    await supabase.rpc("evaluate_review_eligibility", { p_pr_url: prUrl })
  )[0]

  if (!result) {
    return null
  }

  return {
    issueId: result.issue_id,
    pullRequestId: result.pull_request_id,
    eligible: result.eligible,
    reviewCycleId: result.review_cycle_id,
    reviewRunId: result.review_run_id,
    action: result.action as ReviewEligibilityAction,
  }
}

export type ReviewVerdict = "approved" | "changes_requested" | "commented"

export type ReviewFindingInput = {
  severity?: "info" | "warning" | "error" | "blocker"
  filePath?: string | null
  line?: number | null
  title: string
  body?: string | null
  evidence: string
  impact: string
  requestedChange: string
  githubCommentId?: number | null
}

export type CompleteReviewAttemptResult = {
  reviewAttemptId: string | null
  reviewCycleId: string | null
  issueId: string | null
  attemptNumber: number | null
  cycleState: string | null
  // false when the run's verdict is stale (superseded/cancelled/failed, or
  // the run id does not exist) — the caller must not publish it to GitHub.
  accepted: boolean
}

// Records a completed reviewer verdict. Only completion consumes a Review
// Attempt; infrastructure failures go through `failReviewRun` instead.
// Replaying the same `reviewRunId` is idempotent — a run already completed
// returns its original attempt rather than creating a second one.
export async function completeReviewAttempt(
  supabase: Supabase,
  input: {
    reviewRunId: string
    verdict: ReviewVerdict
    summary?: string | null
    githubReviewId?: number | null
    findings?: ReviewFindingInput[]
  }
): Promise<CompleteReviewAttemptResult> {
  const result = unwrap(
    await supabase.rpc("complete_review_attempt", {
      p_review_run_id: input.reviewRunId,
      p_verdict: input.verdict,
      p_summary: input.summary ?? undefined,
      p_github_review_id: input.githubReviewId ?? undefined,
      p_findings: (input.findings ?? []).map((finding) => ({
        severity: finding.severity,
        file_path: finding.filePath ?? null,
        line: finding.line ?? null,
        title: finding.title,
        body: finding.body ?? null,
        evidence: finding.evidence,
        impact: finding.impact,
        requested_change: finding.requestedChange,
        github_comment_id: finding.githubCommentId ?? null,
      })),
    })
  )[0]

  if (!result) {
    throw new ServiceError("not_found", "Review run not found")
  }

  return {
    reviewAttemptId: result.review_attempt_id,
    reviewCycleId: result.review_cycle_id,
    issueId: result.issue_id,
    attemptNumber: result.attempt_number,
    cycleState: result.cycle_state,
    accepted: result.accepted,
  }
}

export type FailReviewRunResult = {
  reviewRunId: string
  reviewCycleId: string | null
  // true when this failure was automatically retried (a fresh pending run
  // was queued). false either because the retry budget (one retry) is
  // spent — automatic progression has stopped — or the run was not
  // completable to begin with.
  retried: boolean
  nextReviewRunId: string | null
  accepted: boolean
}

// Records a reviewer infrastructure failure: never a verdict, never
// consumes a Review Attempt. Retries once automatically; if the retry also
// fails at the same head SHA, automatic progression stops until new code
// arrives or a human acts.
export async function failReviewRun(
  supabase: Supabase,
  input: { reviewRunId: string; error: string }
): Promise<FailReviewRunResult> {
  const result = unwrap(
    await supabase.rpc("fail_review_run", {
      p_review_run_id: input.reviewRunId,
      p_error: input.error,
    })
  )[0]

  if (!result) {
    throw new ServiceError("not_found", "Review run not found")
  }

  return {
    reviewRunId: result.review_run_id,
    reviewCycleId: result.review_cycle_id,
    retried: result.retried,
    nextReviewRunId: result.next_review_run_id,
    accepted: result.accepted,
  }
}

export type SupersedeReason = "new_head_sha" | "human_review"

export type SupersedeActiveReviewCycleResult = {
  reviewCycleId: string | null
  superseded: boolean
}

// Cancels any live run and marks the pull request's active cycle
// superseded. Call with 'human_review' the moment a genuine human
// changes-requested review lands (never for an echo of our own automated
// review — check `isKnownReviewAttempt` first).
export async function supersedeActiveReviewCycle(
  supabase: Supabase,
  prUrl: string,
  reason: SupersedeReason
): Promise<SupersedeActiveReviewCycleResult> {
  const result = unwrap(
    await supabase.rpc("supersede_active_review_cycle", {
      p_pr_url: prUrl,
      p_reason: reason,
    })
  )[0] ?? { review_cycle_id: null, superseded: false }

  return {
    reviewCycleId: result.review_cycle_id,
    superseded: result.superseded,
  }
}

export type ContinueWithHumanReviewResult = {
  reviewCycleId: string
  issueId: string
  status: string
}

// The explicit user override: accept the pull request's human review as
// sufficient without a further automatic verdict. This is the only other
// way (besides an automatic `approved` verdict) a cycle reaches
// `state = 'approved'` — a bare human GitHub approval alone never does.
export async function continueWithHumanReview(
  supabase: Supabase,
  userId: string,
  issueId: string
): Promise<ContinueWithHumanReviewResult> {
  const { data, error } = await supabase
    .rpc("continue_with_human_review", {
      p_user_id: userId,
      p_issue_id: issueId,
    })
    .single()

  if (error) {
    // P0002 = no_data_found (issue not owned / missing); 23514 = no active
    // cycle to continue, or the pull request has moved past the cycle's SHA.
    if (error.code === "P0002") {
      throw new ServiceError("not_found", "Issue not found")
    }
    if (error.code === "23514") {
      throw new ServiceError("validation", error.message)
    }
    throw new ServiceError("internal", error.message)
  }

  return {
    reviewCycleId: data.review_cycle_id,
    issueId: data.issue_id,
    status: data.status,
  }
}

export type RetryReviewRunResult = {
  reviewRunId: string
  reviewCycleId: string
}

// The explicit user "retry now" recovery action for a cycle stuck with no
// live run (typically two trailing infra failures at the current head SHA,
// per `failReviewRun`'s one-automatic-retry budget) — everything else about
// recovery is derived from run history (ADR-0003/0004), but nothing else
// re-arms progression without new code arriving or a human GitHub action.
export async function retryReviewRun(
  supabase: Supabase,
  userId: string,
  reviewCycleId: string
): Promise<RetryReviewRunResult> {
  const { data, error } = await supabase
    .rpc("retry_review_run", {
      p_user_id: userId,
      p_review_cycle_id: reviewCycleId,
    })
    .single()

  if (error) {
    // P0002 = no_data_found (cycle not owned / missing); 23514 = the cycle
    // isn't active, already has a live run, or its attempt budget is spent.
    if (error.code === "P0002") {
      throw new ServiceError("not_found", "Review cycle not found")
    }
    if (error.code === "23514") {
      throw new ServiceError("validation", error.message)
    }
    throw new ServiceError("internal", error.message)
  }

  return {
    reviewRunId: data.review_run_id,
    reviewCycleId: data.review_cycle_id,
  }
}

export type DeliverReviewFixRequestOutcome =
  | "delivered"
  | "already_delivered"
  | "not_found"
  | "not_changes_requested"
  | "cycle_not_active"
  | "stale_head"
  | "no_owner"
  | "owner_unavailable"

export type DeliverReviewFixRequestResult = {
  reviewAttemptId: string
  issueId: string | null
  outcome: DeliverReviewFixRequestOutcome
  // Set iff outcome is 'owner_unavailable' — one of
  // `IMPLEMENTATION_OWNER_UNAVAILABLE_REASONS`
  // (`@gentic/services/issues/implementation-owner`).
  unavailableReason: string | null
}

// Delivers one `changes_requested` Review Attempt's findings to the Issue's
// current durable implementation owner (GEN-417, see ADR-0007) — the
// `deliver_review_fix_request` RPC does the actual work atomically (locking
// the same way `complete_review_attempt`'s cycle/run rows are locked), so
// this is a thin, idempotent wrapper. Call once per completed Review Attempt
// whose verdict is `changes_requested`; replaying the same attempt id is a
// no-op (`already_delivered`).
export async function deliverReviewFixRequest(
  supabase: Supabase,
  input: { reviewAttemptId: string; content: string }
): Promise<DeliverReviewFixRequestResult> {
  const result = unwrap(
    await supabase.rpc("deliver_review_fix_request", {
      p_review_attempt_id: input.reviewAttemptId,
      p_content: input.content,
    })
  )[0]

  if (!result) {
    throw new ServiceError("not_found", "Review attempt not found")
  }

  return {
    reviewAttemptId: result.review_attempt_id,
    issueId: result.issue_id,
    outcome: result.outcome as DeliverReviewFixRequestOutcome,
    unavailableReason: result.unavailable_reason,
  }
}

// Whether a just-recorded `completeReviewAttempt` result should trigger fix
// delivery at all: only a `changes_requested` verdict that was actually
// accepted (not stale/superseded) and left the cycle `active` (not the
// third-attempt `exhausted`, where automatic looping must stop) is
// deliverable. Pulled out so the decision itself — the part with any real
// logic — is unit-testable without a Supabase client.
export function shouldDeliverReviewFix(
  result: Pick<
    CompleteReviewAttemptResult,
    "accepted" | "cycleState" | "reviewAttemptId"
  >,
  verdict: ReviewVerdict
): result is { accepted: true; cycleState: "active"; reviewAttemptId: string } {
  return (
    result.accepted &&
    verdict === "changes_requested" &&
    result.cycleState === "active" &&
    result.reviewAttemptId !== null
  )
}

// Distinguishes a genuine human review from our own automated review being
// echoed back through the GitHub webhook: only an unmatched review id is a
// real human action that should supersede an in-flight automatic cycle.
export async function isKnownReviewAttempt(
  supabase: Supabase,
  githubReviewId: number
): Promise<boolean> {
  const { data, error } = await supabase
    .from("review_attempts")
    .select("id")
    .eq("github_review_id", githubReviewId)
    .maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }

  return data !== null
}
