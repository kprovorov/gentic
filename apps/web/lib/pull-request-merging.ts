import { ServiceError } from "@gentic/services/errors"
import {
  applyPullRequestDeliveryState as defaultApplyPullRequestDeliveryState,
  getGithubIntegration as defaultGetGithubIntegration,
} from "@gentic/services/github-integrations"
import { getIssuePullRequestMergeContext as defaultGetIssuePullRequestMergeContext } from "@gentic/services/issues"
import type { Supabase } from "@gentic/services/types"

import { parsePullNumber } from "@/lib/ci-status"
import {
  fetchPullRequestSnapshot as defaultFetchPullRequestSnapshot,
  fetchRepositoryMergeMethods as defaultFetchRepositoryMergeMethods,
  mergePullRequest as defaultMergePullRequest,
  GithubApiError,
  type GithubMergeMethod,
} from "@/lib/github-app"

export type MergeIssuePullRequestInput = {
  userId: string
  pullRequestId: string
}

export type MergeIssuePullRequestResult = {
  issueId: string
  prUrl: string
  mergeMethod: GithubMergeMethod
  mergeCommitSha: string | null
}

// Injectable for the same reason `PublishReviewVerdictDeps` is: every real
// call here needs a live installation token, so tests substitute fakes rather
// than mocking global `fetch`.
export type MergeIssuePullRequestDeps = {
  getIssuePullRequestMergeContext: typeof defaultGetIssuePullRequestMergeContext
  getGithubIntegration: typeof defaultGetGithubIntegration
  fetchPullRequestSnapshot: typeof defaultFetchPullRequestSnapshot
  fetchRepositoryMergeMethods: typeof defaultFetchRepositoryMergeMethods
  mergePullRequest: typeof defaultMergePullRequest
  applyPullRequestDeliveryState: typeof defaultApplyPullRequestDeliveryState
}

const defaultDeps: MergeIssuePullRequestDeps = {
  getIssuePullRequestMergeContext: defaultGetIssuePullRequestMergeContext,
  getGithubIntegration: defaultGetGithubIntegration,
  fetchPullRequestSnapshot: defaultFetchPullRequestSnapshot,
  fetchRepositoryMergeMethods: defaultFetchRepositoryMergeMethods,
  mergePullRequest: defaultMergePullRequest,
  applyPullRequestDeliveryState: defaultApplyPullRequestDeliveryState,
}

/**
 * Merges an approved pull request on the operator's explicit request
 * (GEN-434) — the action behind the rail's `Merge PR` button.
 *
 * The button's own visibility is decided from the cached
 * `issue_pull_requests` columns, which a webhook can leave a few seconds
 * behind GitHub. That cache is a rendering hint, never the authority: this
 * function re-reads the PR's live state and re-checks approval itself, so a
 * button rendered from a stale row cannot merge a PR that has since been
 * closed, turned into a draft, or had its approval dismissed.
 *
 * @param ownershipSupabase A client the *user's* authorization applies to
 *   (RLS), used to resolve the pull request. Never the service client — the
 *   ownership check lives in that query.
 * @param serviceSupabase The service client, used only for the post-merge
 *   `apply_pull_request_delivery_state` RPC, which is granted to
 *   `service_role` alone.
 */
export async function mergeIssuePullRequest(
  ownershipSupabase: Supabase,
  serviceSupabase: Supabase,
  input: MergeIssuePullRequestInput,
  deps: MergeIssuePullRequestDeps = defaultDeps
): Promise<MergeIssuePullRequestResult> {
  const context = await deps.getIssuePullRequestMergeContext(
    ownershipSupabase,
    input.userId,
    input.pullRequestId
  )

  const pullNumber = parsePullNumber(context.prUrl)
  const [owner, name] = context.repo.split("/")
  if (!pullNumber || !owner || !name) {
    throw new ServiceError(
      "validation",
      "Cannot resolve a pull request to merge"
    )
  }

  const integration = await deps.getGithubIntegration(
    ownershipSupabase,
    input.userId
  )
  if (!integration?.installation_id) {
    throw new ServiceError(
      "forbidden",
      "No GitHub integration connected for this account"
    )
  }
  const installationId = integration.installation_id

  const snapshot = await withGithubErrorsClassified(() =>
    deps.fetchPullRequestSnapshot(installationId, owner, name, pullNumber)
  )

  if (snapshot.state === "merged") {
    throw new ServiceError("conflict", "Pull request is already merged")
  }
  if (snapshot.state === "closed") {
    throw new ServiceError("conflict", "Pull request is closed")
  }
  if (snapshot.state === "draft") {
    throw new ServiceError("conflict", "Pull request is still a draft")
  }
  if (snapshot.reviewDecision !== "approved") {
    throw new ServiceError("conflict", "Pull request is not approved")
  }

  const mergeMethods = await withGithubErrorsClassified(() =>
    deps.fetchRepositoryMergeMethods(installationId, owner, name)
  )
  const mergeMethod = mergeMethods[0]
  if (!mergeMethod) {
    throw new ServiceError(
      "conflict",
      `${context.repo} has every merge method disabled; merge it on GitHub instead`
    )
  }

  const result = await withGithubErrorsClassified(() =>
    deps.mergePullRequest(installationId, owner, name, pullNumber, {
      mergeMethod,
      sha: snapshot.headSha,
    })
  )

  // GitHub answers a refused-but-not-erroring merge with `merged: false` and
  // a reason in `message` (most often "Base branch was modified"). Surface it
  // rather than reporting a merge that did not happen.
  if (!result.merged) {
    throw new ServiceError(
      "conflict",
      result.message || "GitHub did not merge the pull request"
    )
  }

  // The `pull_request` webhook persists this within a second or two anyway,
  // but the operator is looking at the button right now — writing the state
  // eagerly means the rail shows `Merged` on the refetch this action triggers
  // instead of on whichever arrives first. Best-effort: a failure here has
  // not un-merged anything.
  try {
    await deps.applyPullRequestDeliveryState(serviceSupabase, {
      prUrl: context.prUrl,
      state: "merged",
    })
  } catch (error) {
    console.error(
      "[pull-request-merging] failed to persist merged state eagerly:",
      error
    )
  }

  return {
    issueId: context.issueId,
    prUrl: context.prUrl,
    mergeMethod,
    mergeCommitSha: result.sha,
  }
}

// `PUT /pulls/{n}/merge` needs Contents write, which the App did not request
// before GEN-434 — so an installation predating that change fails here with
// the same opaque 403 GitHub uses for a repository it cannot see at all. Name
// the missing permission; the operator otherwise has nothing to act on.
const MISSING_WRITE_PERMISSION_DETAIL = "Resource not accessible by integration"
const MISSING_WRITE_PERMISSION_HINT =
  "The GitHub App installation cannot merge pull requests. Set its Contents " +
  "permission to Read & write and accept the permission request on the " +
  "installation."

const GITHUB_STATUS_TO_SERVICE_ERROR: Record<number, ServiceError["code"]> = {
  401: "forbidden",
  403: "forbidden",
  404: "not_found",
  405: "conflict",
  409: "conflict",
  422: "validation",
  429: "rate_limited",
}

async function withGithubErrorsClassified<T>(
  call: () => Promise<T>
): Promise<T> {
  try {
    return await call()
  } catch (error) {
    throw classifyGithubError(error)
  }
}

export function classifyGithubError(error: unknown): ServiceError {
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
    error instanceof Error ? error.message : "Failed to merge pull request"
  )
}
