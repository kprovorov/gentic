import assert from "node:assert/strict"
import test from "node:test"

import {
  buildReviewMarker,
  hasGenticReviewMarker,
  reviewBodyMarkerReviewRunId,
} from "../lib/review-marker"

test("buildReviewMarker round-trips through reviewBodyMarkerReviewRunId", () => {
  const marker = buildReviewMarker("run-123")
  assert.equal(reviewBodyMarkerReviewRunId(marker), "run-123")
  assert.equal(reviewBodyMarkerReviewRunId(`Some text\n\n${marker}`), "run-123")
})

test("hasGenticReviewMarker is false for a plain human review body", () => {
  assert.equal(hasGenticReviewMarker("Please fix this before merging"), false)
  assert.equal(hasGenticReviewMarker(null), false)
  assert.equal(hasGenticReviewMarker(undefined), false)
  assert.equal(hasGenticReviewMarker(""), false)
})

test("reviewBodyMarkerReviewRunId returns null for a malformed marker", () => {
  assert.equal(
    reviewBodyMarkerReviewRunId("<!-- gentic:review-run:run-1 no closing"),
    null
  )
})
