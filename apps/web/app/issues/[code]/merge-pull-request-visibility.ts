import type { IssuePullRequest } from "@/app/queries"

/**
 * Whether the rail offers `Merge PR` for a pull request (GEN-434).
 *
 * Decided entirely from the cached `issue_pull_requests` columns the rail
 * already receives, which a webhook can leave a few seconds behind GitHub.
 * That is deliberate — this only governs whether a button is drawn.
 * `mergeIssuePullRequest` re-reads the PR's live state and re-checks approval
 * before merging anything, so a stale row costs at worst a button that
 * explains why it cannot merge.
 */
export function canMergePullRequest(pullRequest: {
  state?: IssuePullRequest["state"]
  ci_state: IssuePullRequest["ci_state"]
  review_decision: IssuePullRequest["review_decision"]
}) {
  // `state` is narrowed to `undefined` for the persisted `"unknown"`, and a
  // PR whose state we do not know is not one to offer a merge for. `draft`,
  // `merged`, `closed` and `queued` (already in a merge queue) are all out
  // for their own reasons.
  if (pullRequest.state !== "open") {
    return false
  }
  // Failing CI is the one check state that hides the button outright.
  // `pending` does not: waiting checks are the normal case while a reviewer
  // is approving, and a branch protection rule — which Gentic cannot see — is
  // what decides whether they actually block the merge.
  if (pullRequest.ci_state === "failure") {
    return false
  }

  return pullRequest.review_decision === "approved"
}
