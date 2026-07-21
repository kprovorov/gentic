import type { AgentProvider, IssueStatus } from "@gentic/validators/issues"

import { ServiceError, unwrap } from "../errors"
import type { Supabase } from "../types"
import { getIssue } from "./queries"
import { ISSUE_WITH_PROJECT_SELECT } from "./shared"

export async function resetIssueAgent(
  supabase: Supabase,
  userId: string,
  id: string,
  agentProvider: AgentProvider
) {
  const { data: current, error: fetchError } = await supabase
    .from("issues")
    .select("agent_provider,projects!inner(user_id)")
    .eq("id", id)
    .eq("projects.user_id", userId)
    .maybeSingle()

  if (fetchError) {
    throw new ServiceError("internal", fetchError.message)
  }
  if (!current) {
    throw new ServiceError("not_found", "Issue not found")
  }

  unwrap(
    await supabase.rpc("reset_issue_run", {
      p_issue_id: id,
      p_agent_provider: agentProvider,
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
    .maybeSingle()

  if (fetchError) {
    throw new ServiceError("internal", fetchError.message)
  }
  if (!current) {
    throw new ServiceError("not_found", "Issue not found")
  }

  // Starting a draft is a durable DB transition so prompt consumption and
  // message creation stay atomic with the status change.
  const startsRun = current.status === "draft" && status === "todo"

  if (startsRun) {
    unwrap(await supabase.rpc("start_issue_from_draft", { p_issue_id: id }))
  } else {
    unwrap(await supabase.from("issues").update({ status }).eq("id", id))
  }

  return getIssue(supabase, userId, id)
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
    .maybeSingle()

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
    .maybeSingle()

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
