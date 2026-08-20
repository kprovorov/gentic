import type {
  CreateIssueValues,
  IssuePriority,
  IssueType,
  UpdateIssueValues,
} from "@gentic/validators/issues"
import {
  hasAttachedIssuePullRequest,
  isSpecIssueType,
} from "@gentic/validators/issues"

import { ServiceError, unwrap } from "../errors"
import { ensureLabelsAssignable } from "../labels"
import type { Supabase } from "../types"
import { logIssueEvent } from "./events"
import {
  ensureIssueOwned,
  ensureIssuesOwned,
  ensureProjectOwned,
} from "./ownership"
import { getIssue } from "./queries"
import {
  AUTOMATIC_REVIEW_OVERRIDE_LOCKED_MESSAGE,
  ISSUE_WITH_PROJECT_SELECT,
  SPEC_CONVERSION_BLOCKED_MESSAGE,
} from "./shared"

export async function createIssue(
  supabase: Supabase,
  userId: string,
  input: CreateIssueValues
) {
  await ensureProjectOwned(supabase, userId, input.project_id)

  if (input.label_ids.length > 0) {
    await ensureLabelsAssignable(supabase, userId, input.label_ids)
  }

  const number = unwrap(
    await supabase.rpc("next_issue_number_for_project", {
      p_project_id: input.project_id,
    })
  )

  // Creating straight into `todo` means "hand it to an agent now", which is
  // done by inserting the draft and letting `start_issue_from_draft` open the
  // run. A Spec never runs, so it is simply created in the status it asked for.
  const startsRun = input.status === "todo" && !isSpecIssueType(input.type)

  const result = await supabase
    .from("issues")
    .insert({
      project_id: input.project_id,
      number,
      title: input.title ?? null,
      body: input.body ?? null,
      status: startsRun ? "draft" : input.status,
      priority: input.priority,
      create_pr_automatically: input.create_pr_automatically,
      agent_provider: input.agent_provider,
      issue_model: input.issue_model,
      type: input.type,
    })
    .select(ISSUE_WITH_PROJECT_SELECT)
    .single()

  const issue = unwrap(result)

  if (input.label_ids.length > 0) {
    // The ownership/active-state check above already ran, but a label can
    // still be archived or deleted in the race window between that check and
    // this insert (account-scope and 20-per-issue triggers guard against
    // that too) — if assignment fails, delete the issue we just created
    // rather than leaving a labelless issue behind, so creation stays
    // all-or-nothing for callers.
    const assignmentResult = await supabase.from("issue_labels").insert(
      input.label_ids.map((labelId) => ({
        issue_id: issue.id,
        label_id: labelId,
      }))
    )

    if (assignmentResult.error) {
      await supabase.from("issues").delete().eq("id", issue.id)
      throw new ServiceError("internal", assignmentResult.error.message)
    }
  }

  if (!startsRun) {
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

// Called from the background metadata-generation step after an issue is
// saved with the default priority. Ownership has already been established by
// the request that created the issue.
export async function setIssuePriority(
  supabase: Supabase,
  issueId: string,
  priority: IssuePriority
) {
  unwrap(
    await supabase
      .from("issues")
      .update({ priority, updated_at: new Date().toISOString() })
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
      "agent_provider, issue_model, priority, type, active_run_id, automatic_review_enabled, issue_pull_requests(id), projects!inner(user_id)"
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
  if (
    isSpecIssueType(input.type) &&
    !isSpecIssueType(current.type) &&
    current.active_run_id !== null
  ) {
    throw new ServiceError("validation", SPEC_CONVERSION_BLOCKED_MESSAGE)
  }

  const hasAttachedPullRequest = hasAttachedIssuePullRequest(current)

  if (
    hasAttachedPullRequest &&
    input.automatic_review_enabled !== undefined &&
    input.automatic_review_enabled !== current.automatic_review_enabled
  ) {
    throw new ServiceError(
      "validation",
      AUTOMATIC_REVIEW_OVERRIDE_LOCKED_MESSAGE
    )
  }

  const { data: issue, error: updateError } = await supabase
    .from("issues")
    .update({
      title: input.title,
      body: input.body ?? null,
      agent_provider: input.agent_provider,
      issue_model: input.issue_model,
      type: input.type,
      priority: input.priority,
      ...(input.create_pr_automatically !== undefined && !hasAttachedPullRequest
        ? { create_pr_automatically: input.create_pr_automatically }
        : {}),
      ...(input.automatic_review_enabled !== undefined
        ? { automatic_review_enabled: input.automatic_review_enabled }
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

export async function updateIssueType(
  supabase: Supabase,
  userId: string,
  id: string,
  type: IssueType
) {
  await ensureIssueOwned(supabase, userId, id)

  if (isSpecIssueType(type)) {
    await ensureIssueRunIsFinished(supabase, id)
  }

  const result = await supabase
    .from("issues")
    .update({
      type,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(ISSUE_WITH_PROJECT_SELECT)
    .single()

  return unwrap(result)
}

// Ownership is already established by the caller; this only asks whether a
// worker still holds the issue, which is what makes converting it to a Spec
// unsafe.
async function ensureIssueRunIsFinished(supabase: Supabase, id: string) {
  const { data, error } = await supabase
    .from("issues")
    .select("active_run_id")
    .eq("id", id)
    .maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (data?.active_run_id) {
    throw new ServiceError("validation", SPEC_CONVERSION_BLOCKED_MESSAGE)
  }
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
