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
    }

type WebhookPullRequestState =
  | "draft"
  | "open"
  | "merged"
  | "closed"
  | "queued"
  | "unknown"

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

export async function associatePullRequestFromWebhook(
  supabase: Supabase,
  input: {
    installationId: string | null
    baseRepository: string | null
    headBranch: string | null
    prUrl: string
    prState: WebhookPullRequestState
    readyForReview: boolean
  }
): Promise<PullRequestAssociationDiagnostic> {
  if (!input.installationId || !input.baseRepository || !input.headBranch) {
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
        input.baseRepository.toLowerCase()
    ) {
      return { outcome: "no_match", reason: "repository_out_of_scope" }
    }

    return persistPullRequestAssociation(supabase, existing.issue_id, input)
  }

  const issueCode = parseCanonicalIssueBranch(input.headBranch)
  if (!issueCode) {
    return { outcome: "no_match", reason: "invalid_issue_branch" }
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id,repo")
    .eq("user_id", integration.user_id)
    .eq("key", issueCode.projectKey)
    .maybeSingle()

  if (projectError) {
    throw new ServiceError("internal", projectError.message)
  }
  if (!project) {
    return { outcome: "no_match", reason: "project_not_found" }
  }
  if (project.repo.toLowerCase() !== input.baseRepository.toLowerCase()) {
    return { outcome: "no_match", reason: "repository_out_of_scope" }
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
    return { outcome: "no_match", reason: "issue_not_found" }
  }

  return persistPullRequestAssociation(supabase, issue.id, input)
}

async function persistPullRequestAssociation(
  supabase: Supabase,
  issueId: string,
  input: {
    prUrl: string
    prState: WebhookPullRequestState
    readyForReview: boolean
  }
): Promise<PullRequestAssociationDiagnostic> {
  const result = unwrap(
    await supabase.rpc("associate_pull_request_from_webhook", {
      p_issue_id: issueId,
      p_pr_url: input.prUrl,
      p_pr_state: input.prState,
      p_ready_for_review: input.readyForReview,
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
