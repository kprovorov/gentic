import type {
  CreateIssueValues,
  IssueType,
  UpdateIssueValues,
} from "@gentic/validators/issues"
import { hasAttachedIssuePullRequest } from "@gentic/validators/issues"

import { ServiceError, unwrap } from "../errors"
import type { Supabase } from "../types"
import { logIssueEvent } from "./events"
import {
  ensureIssueOwned,
  ensureIssuesOwned,
  ensureProjectOwned,
} from "./ownership"
import { getIssue } from "./queries"
import { ISSUE_WITH_PROJECT_SELECT } from "./shared"

export async function createIssue(
  supabase: Supabase,
  userId: string,
  input: CreateIssueValues
) {
  await ensureProjectOwned(supabase, userId, input.project_id)

  const number = unwrap(
    await supabase.rpc("next_issue_number_for_project", {
      p_project_id: input.project_id,
    })
  )

  const result = await supabase
    .from("issues")
    .insert({
      project_id: input.project_id,
      number,
      title: input.title ?? null,
      prompt: input.prompt ?? null,
      status: input.status === "todo" ? "draft" : input.status,
      priority: input.priority,
      create_pr_automatically: input.create_pr_automatically,
      agent_provider: input.agent_provider,
      issue_model: input.issue_model,
      type: input.type,
    })
    .select(ISSUE_WITH_PROJECT_SELECT)
    .single()

  const issue = unwrap(result)

  if (input.status !== "todo") {
    return issue
  }

  unwrap(await supabase.rpc("start_issue_from_draft", { p_issue_id: issue.id }))
  return getIssue(supabase, userId, issue.id)
}

export async function startIssueFromDraft(
  supabase: Supabase,
  userId: string,
  id: string
) {
  await ensureIssueOwned(supabase, userId, id)
  unwrap(await supabase.rpc("start_issue_from_draft", { p_issue_id: id }))
}

// Called from the background title-generation step after an issue is saved
// with no title. Runs with a service-role client after authorization happened
// in the request that created the issue.
export async function setIssueTitle(
  supabase: Supabase,
  issueId: string,
  title: string
) {
  unwrap(
    await supabase
      .from("issues")
      .update({ title, updated_at: new Date().toISOString() })
      .eq("id", issueId)
  )
}

// Called from the background type-classification step after an issue is saved
// with the placeholder type. Ownership has already been established by the
// request that created the issue.
export async function setIssueType(
  supabase: Supabase,
  issueId: string,
  type: IssueType
) {
  unwrap(
    await supabase
      .from("issues")
      .update({ type, updated_at: new Date().toISOString() })
      .eq("id", issueId)
  )
}

export async function updateIssue(
  supabase: Supabase,
  userId: string,
  id: string,
  input: UpdateIssueValues
) {
  const { data: current, error: fetchError } = await supabase
    .from("issues")
    .select(
      "agent_provider, issue_model, priority, pr_url, issue_pull_requests(id), projects!inner(user_id)"
    )
    .eq("id", id)
    .eq("projects.user_id", userId)
    .maybeSingle()

  if (fetchError) {
    throw new ServiceError("internal", fetchError.message)
  }
  if (!current) {
    throw new ServiceError("not_found", "Issue not found")
  }

  const hasAttachedPullRequest = hasAttachedIssuePullRequest(current)

  const { data: issue, error: updateError } = await supabase
    .from("issues")
    .update({
      title: input.title,
      prompt: input.prompt ?? null,
      agent_provider: input.agent_provider,
      issue_model: input.issue_model,
      type: input.type,
      priority: input.priority,
      ...(input.create_pr_automatically !== undefined && !hasAttachedPullRequest
        ? { create_pr_automatically: input.create_pr_automatically }
        : {}),
      ...(current.agent_provider !== input.agent_provider ||
      current.issue_model !== input.issue_model
        ? { session_id: null }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(ISSUE_WITH_PROJECT_SELECT)
    .single()

  if (updateError) {
    throw new ServiceError("internal", updateError.message)
  }
  if (!issue) {
    throw new ServiceError("not_found", "Issue not found")
  }

  if (current.priority !== input.priority) {
    await logIssueEvent(supabase, id, "priority_changed", {
      from: current.priority,
      to: input.priority,
    })
  }

  return issue
}

export async function updateIssueTitle(
  supabase: Supabase,
  userId: string,
  id: string,
  title: string
) {
  await ensureIssueOwned(supabase, userId, id)

  const result = await supabase
    .from("issues")
    .update({
      title,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(ISSUE_WITH_PROJECT_SELECT)
    .single()

  return unwrap(result)
}

export async function deleteIssue(
  supabase: Supabase,
  userId: string,
  id: string
) {
  await ensureIssueOwned(supabase, userId, id)

  unwrap(await supabase.from("issues").delete().eq("id", id))
}

export async function bulkDeleteIssues(
  supabase: Supabase,
  userId: string,
  issueIds: string[]
) {
  const uniqueIds = Array.from(new Set(issueIds))
  await ensureIssuesOwned(supabase, userId, uniqueIds)

  unwrap(await supabase.from("issues").delete().in("id", uniqueIds))
}
