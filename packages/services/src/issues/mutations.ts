import type {
  CreateIssueValues,
  IssueType,
  UpdateIssueValues,
} from "@gentic/validators/issues"

import { ServiceError, unwrap } from "../errors"
import type { Supabase } from "../types"
import { ensureIssueOwned, ensureProjectOwned } from "./ownership"
import { ISSUE_WITH_PROJECT_SELECT, kickoffMessageContent } from "./shared"

export async function createIssue(
  supabase: Supabase,
  userId: string,
  input: CreateIssueValues
) {
  await ensureProjectOwned(supabase, userId, input.project_id)

  const result = await supabase
    .from("issues")
    .insert({
      project_id: input.project_id,
      title: input.title ?? null,
      prompt: input.prompt ?? null,
      status: input.status,
      agent_provider: input.agent_provider,
      type: input.type,
    })
    .select(ISSUE_WITH_PROJECT_SELECT)
    .single()

  const issue = unwrap(result)

  if (input.status === "todo") {
    unwrap(
      await supabase.from("messages").insert({
        issue_id: issue.id,
        role: "user",
        content: kickoffMessageContent(input.prompt ?? null),
      })
    )
  }

  return issue
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
    .select("agent_provider, projects!inner(user_id)")
    .eq("id", id)
    .eq("projects.user_id", userId)
    .maybeSingle<{ agent_provider: string }>()

  if (fetchError) {
    throw new ServiceError("internal", fetchError.message)
  }
  if (!current) {
    throw new ServiceError("not_found", "Issue not found")
  }

  const result = await supabase
    .from("issues")
    .update({
      title: input.title,
      prompt: input.prompt ?? null,
      agent_provider: input.agent_provider,
      type: input.type,
      ...(current.agent_provider !== input.agent_provider
        ? { session_id: null }
        : {}),
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
