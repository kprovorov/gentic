// Every GitHub review Gentic's automatic reviewer publishes carries this
// marker in its body, keyed by `review_runs.id` (known before the
// `review_attempts` row that will eventually reference the GitHub review id
// even exists). Two independent consumers rely on it:
//  - publish-time idempotency: search a pull request's existing reviews for
//    this marker before creating a new one, so retrying a timed-out publish
//    (or a crash between the GitHub call succeeding and the DB write) never
//    produces a second GitHub review for the same run.
//  - webhook recognition: the `pull_request_review` webhook echoes this same
//    review back. `review_attempts.github_review_id` is normally how that's
//    recognized as Gentic's own (`isKnownReviewAttempt`), but that lookup
//    only works once the DB write has landed. The marker lets the webhook
//    recognize the review as Gentic-authored straight from the delivered
//    payload, independent of that race.
const MARKER_PREFIX = "<!-- gentic:review-run:"
const MARKER_SUFFIX = " -->"

export function buildReviewMarker(reviewRunId: string): string {
  return `${MARKER_PREFIX}${reviewRunId}${MARKER_SUFFIX}`
}

export function reviewBodyMarkerReviewRunId(
  body: string | null | undefined
): string | null {
  if (!body) {
    return null
  }

  const start = body.indexOf(MARKER_PREFIX)
  if (start === -1) {
    return null
  }

  const idStart = start + MARKER_PREFIX.length
  const end = body.indexOf(MARKER_SUFFIX, idStart)
  if (end === -1) {
    return null
  }

  const reviewRunId = body.slice(idStart, end).trim()
  return reviewRunId.length > 0 ? reviewRunId : null
}

export function hasGenticReviewMarker(
  body: string | null | undefined
): boolean {
  return reviewBodyMarkerReviewRunId(body) !== null
}

/**
 * Whether a delivered review is one Gentic itself published.
 *
 * The marker alone is not proof of authorship — it is a comment in a review
 * body, and anyone able to review the pull request can paste it in. Doing so
 * would make a genuine human `changes_requested` verdict look like Gentic's
 * own echo, so neither the review cycle supersede nor the relay to the agent
 * would fire. The App posts its reviews as `<app-slug>[bot]`, so the login
 * has to agree with the marker before the review counts as ours.
 */
export function isGenticAuthoredReview(
  body: string | null | undefined,
  reviewerLogin: string | null | undefined
): boolean {
  const appSlug = process.env.GITHUB_APP_SLUG

  if (!appSlug || !reviewerLogin) {
    return false
  }

  return (
    hasGenticReviewMarker(body) &&
    reviewerLogin.toLowerCase() === `${appSlug.toLowerCase()}[bot]`
  )
}
