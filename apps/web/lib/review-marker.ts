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
