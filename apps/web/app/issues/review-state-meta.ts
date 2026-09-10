import {
  IconAlertTriangle,
  IconCircleDashed,
  IconClock,
  IconMessage2,
  IconThumbUp,
} from "@tabler/icons-react"

import type { ReviewCycle } from "@gentic/services/issues"

export const REVIEW_ATTEMPT_BUDGET = 3

export const reviewCycleStateMeta = {
  active: {
    label: "Reviewing",
    className: "text-fuchsia-600 dark:text-fuchsia-300",
  },
  approved: {
    label: "Approved",
    className: "text-teal-600 dark:text-teal-300",
  },
  exhausted: {
    label: "Attempts exhausted",
    className: "text-orange-600 dark:text-orange-300",
  },
  superseded: {
    label: "Superseded",
    className: "text-muted-foreground",
  },
} satisfies Record<string, { label: string; className: string }>

export const reviewVerdictMeta = {
  approved: {
    label: "Approved",
    icon: IconThumbUp,
    className: "text-teal-600 dark:text-teal-300",
  },
  changes_requested: {
    label: "Changes requested",
    icon: IconMessage2,
    className: "text-orange-600 dark:text-orange-300",
  },
  commented: {
    label: "Commented",
    icon: IconMessage2,
    className: "text-muted-foreground",
  },
} satisfies Record<
  string,
  { label: string; icon: typeof IconThumbUp; className: string }
>

export const ciStateMeta = {
  unknown: {
    label: "CI unavailable",
    icon: IconCircleDashed,
    className: "text-muted-foreground",
  },
  pending: {
    label: "CI running",
    icon: IconClock,
    className: "text-sky-600 dark:text-sky-300",
  },
  success: {
    label: "CI passed",
    icon: IconThumbUp,
    className: "text-teal-600 dark:text-teal-300",
  },
  failure: {
    label: "CI failed",
    icon: IconAlertTriangle,
    className: "text-red-600 dark:text-red-300",
  },
} satisfies Record<
  string,
  { label: string; icon: typeof IconClock; className: string }
>

export const reviewRunStatusMeta = {
  pending: { label: "Queued" },
  running: { label: "Reviewing" },
  completed: { label: "Completed" },
  failed: { label: "Failed" },
  cancelled: { label: "Cancelled" },
} satisfies Record<string, { label: string }>

/** The most recently created cycle per pull request, keyed by `pullRequestId`. */
export function latestReviewCycleByPullRequest(
  cycles: ReviewCycle[]
): Map<string, ReviewCycle> {
  const byPullRequest = new Map<string, ReviewCycle>()
  // `cycles` is already newest-first (see `listReviewStateForIssue`), so the
  // first cycle seen per pull request is its latest.
  for (const cycle of cycles) {
    if (!byPullRequest.has(cycle.pullRequestId)) {
      byPullRequest.set(cycle.pullRequestId, cycle)
    }
  }
  return byPullRequest
}

export function latestReviewAttempt(cycle: ReviewCycle) {
  return cycle.attempts.at(-1) ?? null
}

export function latestReviewRun(cycle: ReviewCycle) {
  return cycle.runs.at(-1) ?? null
}

export function reviewFindingsCount(cycle: ReviewCycle): number {
  const attempt = latestReviewAttempt(cycle)
  return attempt ? attempt.findings.length : 0
}

export function hasLiveReviewRun(cycle: ReviewCycle): boolean {
  return cycle.runs.some(
    (run) => run.status === "pending" || run.status === "running"
  )
}

/** A cycle is "stuck" once it has no live run left but hasn't concluded — the
 * state the explicit Retry recovery control exists for (see ADR-0004: two
 * trailing infra failures leave a cycle `active` with no live run). */
export function isReviewCycleStuck(cycle: ReviewCycle): boolean {
  if (cycle.state !== "active") {
    return false
  }
  return (
    !hasLiveReviewRun(cycle) && cycle.attempts.length < REVIEW_ATTEMPT_BUDGET
  )
}

export type ReviewRetryTarget = {
  cycle: ReviewCycle
  /** True when a run is still nominally in flight, so re-triggering has to
   * cancel it first (`retry_review_run`'s `p_force`). Drives the button's
   * label and confirmation copy as well as the request itself. */
  force: boolean
}

/** The cycle a "re-trigger the review" control would act on, if any: any
 * `active` cycle with attempt budget left, whether it is stuck with no live
 * run (plain retry) or has a run in flight that has stalled (forced
 * restart). Concluded cycles — approved/exhausted/superseded — and a spent
 * budget yield null, so the control never renders where the RPC would
 * refuse it. */
export function findReviewRetryTarget(
  cycles: ReviewCycle[]
): ReviewRetryTarget | null {
  const cycle = cycles.find(
    (candidate) =>
      candidate.state === "active" &&
      candidate.attempts.length < REVIEW_ATTEMPT_BUDGET
  )
  return cycle ? { cycle, force: hasLiveReviewRun(cycle) } : null
}

export function githubReviewUrl(
  pullRequestUrl: string,
  githubReviewId: number | null
): string | null {
  return githubReviewId
    ? `${pullRequestUrl}#pullrequestreview-${githubReviewId}`
    : null
}
