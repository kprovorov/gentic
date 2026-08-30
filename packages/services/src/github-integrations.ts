import { ServiceError, unwrap } from "./errors"
import type { Supabase } from "./types"

export type GithubIntegrationStatus = "connected" | "pending"

export type GithubIntegration = {
  id: string
  user_id: string
  installation_id: string | null
  setup_action: string | null
  status: GithubIntegrationStatus
  connected_at: string | null
  created_at: string
  updated_at: string
}

export type PullRequestAssociationDiagnostic =
  | {
      outcome: "associated" | "already_associated"
      issueId: string
      statusChanged: boolean
      // Only set on the tracking-Issue path, so the webhook's log line says
      // which of the two associations happened.
      trackedExternally?: true
    }
  | {
      outcome: "no_match"
      reason:
        | "invalid_scope"
        | "invalid_issue_branch"
        | "installation_not_connected"
        | "project_not_found"
        | "repository_out_of_scope"
        | "issue_not_found"
        | "forked_head_repository"
        | "automatic_review_disabled"
    }

type WebhookPullRequestState =
  "draft" | "open" | "merged" | "closed" | "queued" | "unknown"

export type PullRequestCiState = "unknown" | "pending" | "success" | "failure"

export type PullRequestReviewDecision =
  "unknown" | "review_required" | "approved" | "changes_requested"

export function parseCanonicalIssueBranch(branch: string): {
  projectKey: string
  issueNumber: number
} | null {
  const finalSegment = branch.split("/").at(-1)
  if (!finalSegment) {
    return null
  }

  const match = /^([a-z]{3}\d*)-([1-9]\d*)(?:-|$)/i.exec(finalSegment)
  if (!match) {
    return null
  }

  const issueNumber = Number(match[2])
  if (!Number.isSafeInteger(issueNumber)) {
    return null
  }

  return {
    projectKey: match[1].toUpperCase(),
    issueNumber,
  }
}

export type PullRequestWebhookInput = {
  installationId: string | null
  baseRepository: string | null
  headRepository: string | null
  headBranch: string | null
  prUrl: string
  prNumber: number
  prTitle: string | null
  prAuthorLogin: string | null
  prState: WebhookPullRequestState
  readyForReview: boolean
  headSha: string | null
}

export async function associatePullRequestFromWebhook(
  supabase: Supabase,
  input: PullRequestWebhookInput
): Promise<PullRequestAssociationDiagnostic> {
  const { baseRepository, headBranch } = input
  if (!input.installationId || !baseRepository || !headBranch) {
    return { outcome: "no_match", reason: "invalid_scope" }
  }

  const { data: integration, error: integrationError } = await supabase
    .from("github_integrations")
    .select("user_id")
    .eq("installation_id", input.installationId)
    .eq("status", "connected")
    .maybeSingle()

  if (integrationError) {
    throw new ServiceError("internal", integrationError.message)
  }
  if (!integration) {
    return { outcome: "no_match", reason: "installation_not_connected" }
  }

  const { data: existing, error: existingError } = await supabase
    .from("issue_pull_requests")
    .select("issue_id")
    .eq("url", input.prUrl)
    .maybeSingle()

  if (existingError) {
    throw new ServiceError("internal", existingError.message)
  }
  if (existing) {
    const { data: existingIssue, error: existingIssueError } = await supabase
      .from("issues")
      .select("projects!inner(user_id,repo)")
      .eq("id", existing.issue_id)
      .eq("projects.user_id", integration.user_id)
      .maybeSingle()

    if (existingIssueError) {
      throw new ServiceError("internal", existingIssueError.message)
    }
    if (
      !existingIssue ||
      existingIssue.projects.repo.toLowerCase() !==
        baseRepository.toLowerCase()
    ) {
      return { outcome: "no_match", reason: "repository_out_of_scope" }
    }

    return persistPullRequestAssociation(supabase, existing.issue_id, input)
  }

  const branchMatch = await resolveIssueForHeadBranch(
    supabase,
    integration.user_id,
    baseRepository,
    headBranch
  )

  if (typeof branchMatch === "string") {
    return persistPullRequestAssociation(supabase, branchMatch, input)
  }

  // No Issue asked for this pull request — a hand-written branch, a
  // dependency bump, a branch named after an Issue that does not exist. It
  // is still a pull request against a Project's repository, so Automatic
  // Review still applies to it, through a tracking Issue (ADR-0010). The
  // branch-resolution failure stays the diagnostic when tracking declines.
  return trackExternalPullRequest(supabase, integration.user_id, {
    ...input,
    baseRepository,
    unmatchedReason: branchMatch.reason,
  })
}

type UnmatchedIssueBranch = {
  reason:
    | "invalid_issue_branch"
    | "project_not_found"
    | "repository_out_of_scope"
    | "issue_not_found"
}

/**
 * The canonical path: a `GEN-42-...` head branch names the Issue an agent
 * opened the pull request for. Returns the Issue id, or why the branch named
 * no Issue in this account.
 */
async function resolveIssueForHeadBranch(
  supabase: Supabase,
  userId: string,
  baseRepository: string,
  headBranch: string
): Promise<string | UnmatchedIssueBranch> {
  const issueCode = parseCanonicalIssueBranch(headBranch)
  if (!issueCode) {
    return { reason: "invalid_issue_branch" }
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id,repo")
    .eq("user_id", userId)
    .eq("key", issueCode.projectKey)
    .maybeSingle()

  if (projectError) {
    throw new ServiceError("internal", projectError.message)
  }
  if (!project) {
    return { reason: "project_not_found" }
  }
  // A branch whose code points at a Project on another repository names no
  // Issue *here*; the base repository is what decides which Project a pull
  // request belongs to, and the tracking path resolves it from that.
  if (project.repo.toLowerCase() !== baseRepository.toLowerCase()) {
    return { reason: "repository_out_of_scope" }
  }

  const { data: issue, error: issueError } = await supabase
    .from("issues")
    .select("id")
    .eq("project_id", project.id)
    .eq("number", issueCode.issueNumber)
    .maybeSingle()

  if (issueError) {
    throw new ServiceError("internal", issueError.message)
  }
  if (!issue) {
    return { reason: "issue_not_found" }
  }

  return issue.id
}

/**
 * Creates the tracking Issue that gives the Automatic Review lifecycle
 * something to hang a review on for a pull request no Issue produced, and
 * associates the pull request with it. Declines — leaving the pull request
 * entirely untracked, exactly as before this existed — unless every one of
 * these holds:
 *
 * - The pull request is **open and out of draft**. A draft has nothing to
 *   review (the lifecycle refuses a run on one outright), and a closed or
 *   merged one never will; both would only leave an Issue behind. A draft
 *   marked ready arrives here again as `ready_for_review`.
 * - The head branch lives in **the base repository itself**, not a fork.
 *   Reviewing means running a fork author's code on the owner's worker, and
 *   an unvetted fork pull request is the one place that code is untrusted.
 * - The base repository belongs to a Project of the installation's owner
 *   whose **Automatic Review is enabled** — the same setting that decides
 *   whether an agent's own pull requests get reviewed. Nothing new opts in
 *   here, and a Project with review off gets no tracking Issues at all.
 */
async function trackExternalPullRequest(
  supabase: Supabase,
  userId: string,
  input: PullRequestWebhookInput & {
    baseRepository: string
    unmatchedReason: UnmatchedIssueBranch["reason"]
  }
): Promise<PullRequestAssociationDiagnostic> {
  if (!input.readyForReview) {
    return { outcome: "no_match", reason: input.unmatchedReason }
  }
  if (
    !input.headRepository ||
    input.headRepository.toLowerCase() !== input.baseRepository.toLowerCase()
  ) {
    return { outcome: "no_match", reason: "forked_head_repository" }
  }

  const project = await findProjectForRepository(
    supabase,
    userId,
    input.baseRepository
  )

  if (!project) {
    return { outcome: "no_match", reason: "project_not_found" }
  }
  // Checked again inside `track_external_pull_request`, where the read is
  // atomic with creating the Issue; this one keeps the common "review is
  // off" case out of the RPC and gives the webhook log a precise reason.
  if (!project.automatic_review_enabled) {
    return { outcome: "no_match", reason: "automatic_review_disabled" }
  }

  // The Project's own spelling of the repository, not the webhook's, so the
  // body reads the same as everywhere else in the app.
  const trackingIssue = buildTrackingIssueContent({
    ...input,
    baseRepository: project.repo,
  })

  const result = unwrap(
    await supabase.rpc("track_external_pull_request", {
      p_project_id: project.id,
      p_pr_url: input.prUrl,
      p_pr_state: input.prState,
      p_ready_for_review: input.readyForReview,
      p_title: trackingIssue.title,
      p_body: trackingIssue.body,
      p_head_sha: input.headSha ?? undefined,
    })
  )[0]

  // The RPC returns nothing when the Project's Automatic Review was switched
  // off between the check above and the write.
  if (!result) {
    return { outcome: "no_match", reason: "automatic_review_disabled" }
  }

  return {
    outcome: result.association_created ? "associated" : "already_associated",
    issueId: result.associated_issue_id,
    statusChanged: result.issue_status_changed,
    trackedExternally: true,
  }
}

/**
 * The Project a pull request belongs to, by its base repository. Unlike the
 * head-branch path there is no Project key to disambiguate with, so the
 * oldest Project on the repository wins — deterministic for the one case
 * that can produce two, the same repository added to a second Project.
 */
async function findProjectForRepository(
  supabase: Supabase,
  userId: string,
  baseRepository: string
) {
  const projects = unwrap(
    await supabase
      .from("projects")
      .select("id,repo,automatic_review_enabled")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
  )

  return (
    projects.find(
      (project) => project.repo.toLowerCase() === baseRepository.toLowerCase()
    ) ?? null
  )
}

const TRACKING_ISSUE_TITLE_MAX_LENGTH = 160

/**
 * The tracking Issue's own title and body. The body is not decoration: it is
 * what the reviewer agent is handed as "the original issue" (see
 * `getReviewRunContext`), so it has to say plainly that there is no
 * specification behind this pull request rather than leave the reviewer
 * inventing one to judge the diff against.
 */
export function buildTrackingIssueContent(input: {
  prNumber: number
  prTitle: string | null
  prAuthorLogin: string | null
  prUrl: string
  baseRepository: string
}): { title: string; body: string } {
  const prTitle = input.prTitle?.trim()
  const title = `PR #${input.prNumber}: ${prTitle || "Untitled pull request"}`
  const author = input.prAuthorLogin ? `@${input.prAuthorLogin}` : "GitHub"

  return {
    title: title.slice(0, TRACKING_ISSUE_TITLE_MAX_LENGTH),
    body: [
      `Automatic Review tracking issue for ${input.baseRepository}#${input.prNumber}, opened by ${author}.`,
      "",
      input.prUrl,
      "",
      "Gentic created this issue because the pull request was not opened by " +
        "an agent working on an existing issue. It exists so Automatic " +
        "Review can run against the pull request; no implementation agent " +
        "is assigned to it, and there is no issue specification behind the " +
        "change — review the pull request on its own terms.",
    ].join("\n"),
  }
}

async function persistPullRequestAssociation(
  supabase: Supabase,
  issueId: string,
  input: {
    prUrl: string
    prState: WebhookPullRequestState
    readyForReview: boolean
    headSha: string | null
  }
): Promise<PullRequestAssociationDiagnostic> {
  const result = unwrap(
    await supabase.rpc("associate_pull_request_from_webhook", {
      p_issue_id: issueId,
      p_pr_url: input.prUrl,
      p_pr_state: input.prState,
      p_ready_for_review: input.readyForReview,
      p_head_sha: input.headSha ?? undefined,
    })
  )[0]

  if (!result) {
    throw new ServiceError(
      "internal",
      "Pull request association returned no result"
    )
  }

  return {
    outcome: result.association_created ? "associated" : "already_associated",
    issueId: result.associated_issue_id,
    statusChanged: result.issue_status_changed,
  }
}

export async function applyPullRequestDeliveryState(
  supabase: Supabase,
  input: {
    prUrl: string
    state?: WebhookPullRequestState
    headSha?: string
    ciState?: PullRequestCiState
    reviewDecision?: PullRequestReviewDecision
    expectedHeadSha?: string
  }
) {
  return (
    unwrap(
      await supabase.rpc("apply_pull_request_delivery_state", {
        p_pr_url: input.prUrl,
        p_state: input.state,
        p_head_sha: input.headSha,
        p_ci_state: input.ciState,
        p_review_decision: input.reviewDecision,
        p_expected_head_sha: input.expectedHeadSha,
      })
    )[0] ?? null
  )
}

export async function getGithubIntegration(supabase: Supabase, userId: string) {
  return unwrap(
    await supabase
      .from("github_integrations")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle()
  ) as GithubIntegration | null
}

export async function createGithubIntegrationState(
  supabase: Supabase,
  userId: string,
  state: string
) {
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
  unwrap(
    await supabase.from("github_integration_states").insert({
      state,
      user_id: userId,
      expires_at: expiresAt,
    })
  )
}

export async function consumeGithubIntegrationState(
  supabase: Supabase,
  userId: string,
  state: string
) {
  const { data, error } = await supabase
    .from("github_integration_states")
    .delete()
    .eq("state", state)
    .eq("user_id", userId)
    .gt("expires_at", new Date().toISOString())
    .select("state")
    .maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (!data) {
    throw new ServiceError(
      "validation",
      "Invalid or expired GitHub setup state"
    )
  }
}

export async function upsertGithubIntegration(
  supabase: Supabase,
  userId: string,
  input: {
    installationId: string | null
    setupAction: string | null
    status: GithubIntegrationStatus
  }
) {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from("github_integrations")
    .upsert(
      {
        user_id: userId,
        installation_id: input.installationId,
        setup_action: input.setupAction,
        status: input.status,
        connected_at: input.status === "connected" ? now : null,
        updated_at: now,
      },
      { onConflict: "user_id" }
    )
    .select("*")
    .single()

  if (error?.code === "23505") {
    throw new ServiceError(
      "conflict",
      "This GitHub installation is already connected to another Gentic account."
    )
  }
  if (error) {
    throw new ServiceError("internal", error.message)
  }

  return data as GithubIntegration
}

export async function deleteGithubIntegration(
  supabase: Supabase,
  userId: string
) {
  unwrap(
    await supabase.from("github_integrations").delete().eq("user_id", userId)
  )
}
