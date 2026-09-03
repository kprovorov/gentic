import type { ImplementationOwner, ReviewCycle } from "@gentic/services/issues"

import { isReviewCycleStuck } from "@/app/issues/review-state-meta"

/** Whether any recovery control would render, so a caller can decide whether
 * to show the surrounding section at all rather than an empty heading.
 * Kept import-free of the client component and its server actions (see
 * `manual-create-pr-visibility.ts` for the same split), so this stays
 * testable under the plain Node test runner. */
export function hasReviewRecoveryControls(
  reviewCycles: ReviewCycle[],
  implementationOwner: ImplementationOwner | null
): boolean {
  return (
    reviewCycles.some(isReviewCycleStuck) ||
    reviewCycles.some((cycle) => cycle.state === "active") ||
    (implementationOwner !== null && !implementationOwner.resumable)
  )
}
