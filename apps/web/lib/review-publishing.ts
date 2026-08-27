import { ServiceError } from "@gentic/services/errors"
import { getGithubIntegration as defaultGetGithubIntegration } from "@gentic/services/github-integrations"
import type { Supabase } from "@gentic/services/types"
import type {
  ReviewFindingInput,
  ReviewVerdict,
} from "@gentic/services/review-lifecycle"

import { parsePullNumber } from "@/lib/ci-status"
import {
  createPullRequestReview as defaultCreatePullRequestReview,
  fetchPullRequestReviewComments as defaultFetchPullRequestReviewComments,
  fetchPullRequestReviews as defaultFetchPullRequestReviews,
  fetchPullRequestSnapshot as defaultFetchPullRequestSnapshot,
  GithubApiError,
  type GithubPullRequestReview,
  type GithubReviewEvent,
} from "@/lib/github-app"
import {
  buildReviewMarker,
  reviewBodyMarkerReviewRunId,
} from "@/lib/review-marker"

const VERDICT_TO_EVENT: Record<ReviewVerdict, GithubReviewEvent> = {
  approved: "APPROVE",
  changes_requested: "REQUEST_CHANGES",
  commented: "COMMENT",
}

export type PublishReviewVerdictInput = {
  reviewRunId: string
  userId: string
  repo: string
  prUrl: string
  // The exact commit this verdict was produced against
  // (`review_runs.head_sha`) — the publish step's own authority for "never
  // published against a different head SHA", independent of whatever the
  // database's `issue_pull_requests.head_sha` says by the time this runs.
  expectedHeadSha: string
  verdict: ReviewVerdict
  summary: string | null
  findings: ReviewFindingInput[]
}

export type PublishReviewVerdictResult = {
  githubReviewId: number
  // Same findings, with `githubCommentId` filled in where a matching inline
  // comment was found — best-effort, not required for correctness.
  findings: ReviewFindingInput[]
}

// Injectable the same way `handleGithubWebhookRequest`'s `pullRequestServices`
// and the worker's `ProcessReviewRunDeps` are — real GitHub calls otherwise
// require a live installation token, so tests substitute fakes here instead
// of mocking global `fetch`.
export type PublishReviewVerdictDeps = {
  getGithubIntegration: typeof defaultGetGithubIntegration
  fetchPullRequestSnapshot: typeof defaultFetchPullRequestSnapshot
  fetchPullRequestReviews: typeof defaultFetchPullRequestReviews
  createPullRequestReview: typeof defaultCreatePullRequestReview
  fetchPullRequestReviewComments: typeof defaultFetchPullRequestReviewComments
}

const defaultDeps: PublishReviewVerdictDeps = {
  getGithubIntegration: defaultGetGithubIntegration,
  fetchPullRequestSnapshot: defaultFetchPullRequestSnapshot,
  fetchPullRequestReviews: defaultFetchPullRequestReviews,
  createPullRequestReview: defaultCreatePullRequestReview,
  fetchPullRequestReviewComments: defaultFetchPullRequestReviewComments,
}

/**
 * Publishes a validated reviewer verdict (GEN-415's output) as a real GitHub
 * pull-request review (GEN-416). Called from the `complete` route, before
 * the verdict is persisted via `completeReviewAttempt` — this is the only
 * place with both GitHub App credentials and the freshly-produced verdict,
 * since the isolated reviewer runtime is deliberately denied both (ADR-0006).
 *
 * Every failure throws `ServiceError` with a code chosen for retryability:
 * `forbidden`/`validation`/`conflict` are not worth retrying as-is (missing
 * integration, malformed input, stale head/closed/draft PR); `rate_limited`
 * and `internal` (GitHub 5xx or a network failure) are transient. The
 * `complete` route lets all of these propagate uncaught, which fails the
 * review run the same way any other infra failure does — `fail_review_run`'s
 * existing one-retry budget applies uniformly, so this never needs its own
 * retry loop.
 */
export async function publishReviewVerdict(
  supabase: Supabase,
  input: PublishReviewVerdictInput,
  deps: PublishReviewVerdictDeps = defaultDeps
): Promise<PublishReviewVerdictResult> {
  const pullNumber = parsePullNumber(input.prUrl)
  const [owner, name] = input.repo.split("/")
  if (!pullNumber || !owner || !name) {
    throw new ServiceError(
      "validation",
      "Cannot resolve a pull request to publish the review to"
    )
  }

  const integration = await deps.getGithubIntegration(supabase, input.userId)
  if (!integration?.installation_id) {
    throw new ServiceError(
      "forbidden",
      "No GitHub integration connected for this account"
    )
  }
  const installationId = integration.installation_id

  const snapshot = await deps.fetchPullRequestSnapshot(
    installationId,
    owner,
    name,
    pullNumber
  )

  if (snapshot.state === "closed" || snapshot.state === "merged") {
    throw new ServiceError(
      "conflict",
      "Pull request is closed; the verdict cannot be published"
    )
  }
  if (snapshot.state === "draft") {
    throw new ServiceError(
      "conflict",
      "Pull request is a draft; the verdict cannot be published"
    )
  }
  if (snapshot.headSha !== input.expectedHeadSha) {
    throw new ServiceError(
      "conflict",
      "Pull request head has moved since this verdict was produced"
    )
  }

  const marker = buildReviewMarker(input.reviewRunId)

  const existing = await findExistingPublishedReview(
    deps,
    installationId,
    owner,
    name,
    pullNumber,
    input.reviewRunId
  )
  if (existing) {
    return { githubReviewId: existing.id, findings: input.findings }
  }

  const inlineFindings = input.findings.filter(
    (
      finding
    ): finding is ReviewFindingInput & { filePath: string; line: number } =>
      Boolean(finding.filePath) && Boolean(finding.line)
  )
  const reviewLevelFindings = input.findings.filter(
    (finding) => !finding.filePath || !finding.line
  )

  try {
    const review = await deps.createPullRequestReview(
      installationId,
      owner,
      name,
      pullNumber,
      {
        commitId: input.expectedHeadSha,
        event: VERDICT_TO_EVENT[input.verdict],
        body: buildReviewBody(
          input.verdict,
          input.summary,
          reviewLevelFindings,
          marker
        ),
        comments: inlineFindings.map((finding) => ({
          path: finding.filePath,
          line: finding.line,
          body: formatFindingBody(finding),
        })),
      }
    )

    const findings =
      inlineFindings.length > 0
        ? await reconcileFindingCommentIds(
            deps,
            input.findings,
            installationId,
            owner,
            name,
            pullNumber,
            review.id
          )
        : input.findings

    return { githubReviewId: review.id, findings }
  } catch (error) {
    if (
      error instanceof GithubApiError &&
      error.status === 422 &&
      inlineFindings.length > 0
    ) {
      // GitHub rejects the whole review if any inline comment's path/line
      // isn't part of the diff it knows about (e.g. the reviewer cited a
      // line the PR's diff no longer touches). Better to publish the
      // verdict with every finding folded into the body than to lose it
      // entirely — inline findings degrade to review-level findings rather
      // than being dropped.
      const review = await deps.createPullRequestReview(
        installationId,
        owner,
        name,
        pullNumber,
        {
          commitId: input.expectedHeadSha,
          event: VERDICT_TO_EVENT[input.verdict],
          body: buildReviewBody(
            input.verdict,
            input.summary,
            input.findings,
            marker
          ),
        }
      )
      return { githubReviewId: review.id, findings: input.findings }
    }

    throw classifyGithubError(error)
  }
}

async function findExistingPublishedReview(
  deps: PublishReviewVerdictDeps,
  installationId: string,
  owner: string,
  repo: string,
  pullNumber: number,
  reviewRunId: string
): Promise<GithubPullRequestReview | null> {
  const reviews = await deps.fetchPullRequestReviews(
    installationId,
    owner,
    repo,
    pullNumber
  )
  return (
    reviews.find(
      (review) => reviewBodyMarkerReviewRunId(review.body) === reviewRunId
    ) ?? null
  )
}

async function reconcileFindingCommentIds(
  deps: PublishReviewVerdictDeps,
  findings: ReviewFindingInput[],
  installationId: string,
  owner: string,
  repo: string,
  pullNumber: number,
  reviewId: number
): Promise<ReviewFindingInput[]> {
  try {
    const comments = await deps.fetchPullRequestReviewComments(
      installationId,
      owner,
      repo,
      pullNumber,
      reviewId
    )
    const remaining = [...comments]

    return findings.map((finding) => {
      if (!finding.filePath || !finding.line) {
        return finding
      }
      const index = remaining.findIndex(
        (comment) =>
          comment.path === finding.filePath && comment.line === finding.line
      )
      if (index === -1) {
        return finding
      }
      const [comment] = remaining.splice(index, 1)
      return { ...finding, githubCommentId: comment.id }
    })
  } catch (error) {
    // Best-effort: the review itself already published successfully. Losing
    // the finding<->comment linkage is a lesser degradation than failing the
    // whole run over it.
    console.error(
      "[review-publishing] failed to reconcile finding comment ids:",
      error
    )
    return findings
  }
}

function defaultSummaryFor(verdict: ReviewVerdict): string {
  switch (verdict) {
    case "approved":
      return "Automatic review approved this pull request."
    case "changes_requested":
      return "Automatic review requested changes."
    case "commented":
      return "Automatic review left feedback."
  }
}

function formatFindingBody(finding: ReviewFindingInput): string {
  return [
    `**${finding.title}**`,
    finding.evidence,
    `Impact: ${finding.impact}`,
    `Requested change: ${finding.requestedChange}`,
  ].join("\n\n")
}

function formatReviewLevelFinding(finding: ReviewFindingInput): string {
  const location = finding.filePath
    ? `${finding.filePath}${finding.line ? `:${finding.line}` : ""} — `
    : ""
  return `- ${location}${formatFindingBody(finding)}`
}

function buildReviewBody(
  verdict: ReviewVerdict,
  summary: string | null,
  reviewLevelFindings: ReviewFindingInput[],
  marker: string
): string {
  const parts = [summary?.trim() || defaultSummaryFor(verdict)]

  if (reviewLevelFindings.length > 0) {
    parts.push(reviewLevelFindings.map(formatReviewLevelFinding).join("\n\n"))
  }

  parts.push(marker)
  return parts.join("\n\n")
}

// Publishing a verdict is the only write Gentic makes against the GitHub
// API — every other call in `github-app.ts` is a read. So an installation
// whose "Pull requests" permission is still read-only sails through the
// eligibility, snapshot, and idempotency checks and only fails here, with
// the same opaque 403 GitHub uses for a repository the installation cannot
// see at all. Name the missing permission: the reviewer has already done
// its work by this point, and the operator otherwise has nothing to act on.
const MISSING_WRITE_PERMISSION_DETAIL = "Resource not accessible by integration"
const MISSING_WRITE_PERMISSION_HINT =
  "The GitHub App installation cannot write reviews. Set its Pull requests " +
  "permission to Read & write and accept the permission request on the " +
  "installation."

const GITHUB_STATUS_TO_SERVICE_ERROR: Record<number, ServiceError["code"]> = {
  401: "forbidden",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "validation",
  429: "rate_limited",
}

function classifyGithubError(error: unknown): ServiceError {
  if (error instanceof GithubApiError) {
    const code = GITHUB_STATUS_TO_SERVICE_ERROR[error.status] ?? "internal"
    const missingPermission =
      error.status === 403 &&
      error.message.includes(MISSING_WRITE_PERMISSION_DETAIL)
    return new ServiceError(
      code,
      missingPermission
        ? `${error.message} — ${MISSING_WRITE_PERMISSION_HINT}`
        : error.message
    )
  }
  if (error instanceof ServiceError) {
    return error
  }
  return new ServiceError(
    "internal",
    error instanceof Error
      ? error.message
      : "Failed to publish review to GitHub"
  )
}
