import type { AgentProvider, IssueStatus } from "@gentic/validators/issues"

import { ServiceError, unwrap } from "../errors"
import type { Supabase } from "../types"
import { ISSUE_WITH_PROJECT_SELECT, kickoffMessageContent } from "./shared"

export async function resetIssueAgent(
  supabase: Supabase,
  userId: string,
  id: string,
  agentProvider: AgentProvider
) {
  const { data: current, error: fetchError } = await supabase
    .from("issues")
    .select("prompt,agent_provider,projects!inner(user_id)")
    .eq("id", id)
    .eq("projects.user_id", userId)
    .maybeSingle<{
      prompt: string | null
      agent_provider: AgentProvider
    }>()

  if (fetchError) {
    throw new ServiceError("internal", fetchError.message)
  }
  if (!current) {
    throw new ServiceError("not_found", "Issue not found")
  }

  unwrap(await supabase.from("messages").delete().eq("issue_id", id))
  unwrap(await supabase.from("issue_pull_requests").delete().eq("issue_id", id))

  const now = new Date().toISOString()
  unwrap(
    await supabase
      .from("issues")
      .update({
        status: "todo",
        agent_provider: agentProvider,
        session_id: null,
        run_error: null,
        run_started_at: null,
        run_finished_at: null,
        usage_limit_reset_at: null,
        pr_url: null,
        updated_at: now,
      })
      .eq("id", id)
  )

  unwrap(
    await supabase.from("messages").insert({
      issue_id: id,
      role: "user",
      content: kickoffMessageContent(current.prompt),
    })
  )
}

export async function updateIssueStatus(
  supabase: Supabase,
  userId: string,
  id: string,
  status: IssueStatus
) {
  const { data: current, error: fetchError } = await supabase
    .from("issues")
    .select("status,prompt,projects!inner(user_id)")
    .eq("id", id)
    .eq("projects.user_id", userId)
    .maybeSingle<{
      status: string
      prompt: string | null
    }>()

  if (fetchError) {
    throw new ServiceError("internal", fetchError.message)
  }
  if (!current) {
    throw new ServiceError("not_found", "Issue not found")
  }

  // Moving an issue from Draft to Todo starts an agent run: the worker picks
  // up `status = 'todo'` issues and drives the selected coding agent.
  const startsRun = current.status === "draft" && status === "todo"

  const result = await supabase
    .from("issues")
    .update(startsRun ? { status, usage_limit_reset_at: null } : { status })
    .eq("id", id)
    .select(ISSUE_WITH_PROJECT_SELECT)
    .single()

  const data = unwrap(result)

  if (startsRun) {
    unwrap(
      await supabase.from("messages").insert({
        issue_id: id,
        role: "user",
        content: kickoffMessageContent(current.prompt),
      })
    )
  }

  return data
}

export async function updateIssueAgentProvider(
  supabase: Supabase,
  userId: string,
  id: string,
  agentProvider: AgentProvider
) {
  const { data: current, error: fetchError } = await supabase
    .from("issues")
    .select("run_started_at,projects!inner(user_id)")
    .eq("id", id)
    .eq("projects.user_id", userId)
    .maybeSingle<{ run_started_at: string | null }>()

  if (fetchError) {
    throw new ServiceError("internal", fetchError.message)
  }
  if (!current) {
    throw new ServiceError("not_found", "Issue not found")
  }
  if (current.run_started_at) {
    throw new ServiceError(
      "validation",
      "Agent cannot be changed after an issue has started"
    )
  }

  const result = await supabase
    .from("issues")
    .update({
      agent_provider: agentProvider,
      session_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(ISSUE_WITH_PROJECT_SELECT)
    .single()

  return unwrap(result)
}

// Called from the GitHub webhook route, which is trusted server code
// authenticated by the webhook signature rather than a Clerk user. There is no
// `userId` to check ownership against, so the exact PR URL is used to find a
// tracked issue pull request, with a fallback to the legacy `issues.pr_url`.
export async function updateIssueStatusByPrUrl(
  supabase: Supabase,
  prUrl: string,
  status: IssueStatus
) {
  const { data: pullRequest, error: pullRequestError } = await supabase
    .from("issue_pull_requests")
    .select("issue_id")
    .eq("url", prUrl)
    .maybeSingle<{ issue_id: string }>()

  if (pullRequestError) {
    throw new ServiceError("internal", pullRequestError.message)
  }

  if (pullRequest) {
    return unwrap(
      await supabase
        .from("issues")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", pullRequest.issue_id)
        .select("id")
        .maybeSingle()
    )
  }

  return unwrap(
    await supabase
      .from("issues")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("pr_url", prUrl)
      .select("id")
      .maybeSingle()
  )
}

export async function attachIssuePullRequest(
  supabase: Supabase,
  issueId: string,
  prUrl: string
) {
  return unwrap(
    await supabase
      .from("issue_pull_requests")
      .upsert(
        { issue_id: issueId, url: prUrl },
        { onConflict: "url", ignoreDuplicates: true }
      )
  )
}
