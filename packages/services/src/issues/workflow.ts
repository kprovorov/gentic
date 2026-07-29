import type { AutomaticPrRequestStatus } from "@gentic/validators/agent"
import type {
  AgentProvider,
  IssueModel,
  IssuePriority,
  IssueStatus,
} from "@gentic/validators/issues"

import { ServiceError, unwrap } from "../errors"
import type { Supabase } from "../types"
import { logIssueEvent } from "./events"
import { ensureIssueOwned } from "./ownership"
import {
  formatPublishingRequest,
  generateFirstPublishBranchName,
} from "./publish"
import { getIssue } from "./queries"
import {
  getIssueCode,
  ISSUE_WITH_PROJECT_SELECT,
  type UserChatMessage,
} from "./shared"

export async function resetIssueAgent(
  supabase: Supabase,
  userId: string,
  id: string,
  agentProvider: AgentProvider,
  issueModel: IssueModel
): Promise<UserChatMessage> {
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
      p_issue_model: issueModel,
    })
  )

  return unwrap(
    await supabase
      .from("messages")
      .select(
        "id,role,kind,content,status,author_type,generated_action,created_at,event_id,run_id,event_type,event_status,event_ts,event_seq,tool_call_id,payload"
      )
      .eq("issue_id", id)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(1)
      .single<UserChatMessage>()
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

  await logIssueEvent(supabase, id, "status_changed", {
    from: current.status,
    to: status,
  })

  return getIssue(supabase, userId, id)
}

export async function bulkUpdateIssueStatus(
  supabase: Supabase,
  userId: string,
  issueIds: string[],
  status: IssueStatus
) {
  const uniqueIds = Array.from(new Set(issueIds))
  const { data: issues, error: fetchError } = await supabase
    .from("issues")
    .select("id,status,projects!inner(user_id)")
    .in("id", uniqueIds)
    .eq("projects.user_id", userId)

  if (fetchError) {
    throw new ServiceError("internal", fetchError.message)
  }
  if (!issues || issues.length !== uniqueIds.length) {
    throw new ServiceError("not_found", "Issue not found")
  }

  const draftIds =
    status === "todo"
      ? issues
          .filter((issue) => issue.status === "draft")
          .map((issue) => issue.id)
      : []
  const draftIdSet = new Set(draftIds)
  const directUpdateIds =
    status === "todo"
      ? uniqueIds.filter((id) => !draftIdSet.has(id))
      : uniqueIds

  await Promise.all(
    draftIds.map(async (id) => {
      unwrap(await supabase.rpc("start_issue_from_draft", { p_issue_id: id }))
    })
  )

  if (directUpdateIds.length === 0) {
    return
  }

  unwrap(
    await supabase
      .from("issues")
      .update({ status, updated_at: new Date().toISOString() })
      .in("id", directUpdateIds)
  )
}

export async function updateIssuePriority(
  supabase: Supabase,
  userId: string,
  id: string,
  priority: IssuePriority
) {
  const { data: current, error: fetchError } = await supabase
    .from("issues")
    .select("priority,projects!inner(user_id)")
    .eq("id", id)
    .eq("projects.user_id", userId)
    .maybeSingle()

  if (fetchError) {
    throw new ServiceError("internal", fetchError.message)
  }
  if (!current) {
    throw new ServiceError("not_found", "Issue not found")
  }
  if (current.priority === priority) {
    return getIssue(supabase, userId, id)
  }

  unwrap(
    await supabase
      .from("issues")
      .update({ priority, updated_at: new Date().toISOString() })
      .eq("id", id)
  )

  await logIssueEvent(supabase, id, "priority_changed", {
    from: current.priority,
    to: priority,
  })

  return getIssue(supabase, userId, id)
}

export async function bulkUpdateIssuePriority(
  supabase: Supabase,
  userId: string,
  issueIds: string[],
  priority: IssuePriority
) {
  const uniqueIds = Array.from(new Set(issueIds))
  const { data: issues, error: fetchError } = await supabase
    .from("issues")
    .select("id,priority,projects!inner(user_id)")
    .in("id", uniqueIds)
    .eq("projects.user_id", userId)

  if (fetchError) {
    throw new ServiceError("internal", fetchError.message)
  }
  if (!issues || issues.length !== uniqueIds.length) {
    throw new ServiceError("not_found", "Issue not found")
  }

  const changedIssues = issues.filter((issue) => issue.priority !== priority)
  if (changedIssues.length === 0) {
    return
  }

  unwrap(
    await supabase
      .from("issues")
      .update({ priority, updated_at: new Date().toISOString() })
      .in(
        "id",
        changedIssues.map((issue) => issue.id)
      )
  )

  await Promise.all(
    changedIssues.map((issue) =>
      logIssueEvent(supabase, issue.id, "priority_changed", {
        from: issue.priority,
        to: priority,
      })
    )
  )
}

export async function updateIssueAgentProvider(
  supabase: Supabase,
  userId: string,
  id: string,
  agentProvider: AgentProvider,
  issueModel: IssueModel
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
      issue_model: issueModel,
      session_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(ISSUE_WITH_PROJECT_SELECT)
    .single()

  return unwrap(result)
}

export async function bulkUpdateIssueAgentProvider(
  supabase: Supabase,
  userId: string,
  issueIds: string[],
  agentProvider: AgentProvider
) {
  const uniqueIds = Array.from(new Set(issueIds))
  const { data: issues, error: fetchError } = await supabase
    .from("issues")
    .select("id,run_started_at,projects!inner(user_id)")
    .in("id", uniqueIds)
    .eq("projects.user_id", userId)

  if (fetchError) {
    throw new ServiceError("internal", fetchError.message)
  }
  if (!issues || issues.length !== uniqueIds.length) {
    throw new ServiceError("not_found", "Issue not found")
  }
  if (issues.some((issue) => issue.run_started_at)) {
    throw new ServiceError(
      "validation",
      "Agent cannot be changed after an issue has started"
    )
  }

  unwrap(
    await supabase
      .from("issues")
      .update({
        agent_provider: agentProvider,
        issue_model: null,
        session_id: null,
        updated_at: new Date().toISOString(),
      })
      .in("id", uniqueIds)
  )
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

  const { data: current, error: fetchError } = await (pullRequest
    ? supabase
        .from("issues")
        .select("id,status")
        .eq("id", pullRequest.issue_id)
        .maybeSingle()
    : supabase
        .from("issues")
        .select("id,status")
        .eq("pr_url", prUrl)
        .maybeSingle())

  if (fetchError) {
    throw new ServiceError("internal", fetchError.message)
  }
  if (!current) {
    return null
  }

  const result = unwrap<{ id: string } | null>(
    await supabase
      .from("issues")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", current.id)
      .eq("status", current.status)
      .select("id")
      .maybeSingle()
  )

  if (result) {
    await logIssueEvent(supabase, result.id, "status_changed", {
      from: current.status,
      to: status,
    })
  }

  return result
}

// Called from the run-state route (trusted server code) right before it
// decides whether a freshly reported PR needs a CI check before going to
// `ready-for-review`. No RLS concern here since the issue was already
// ownership-checked earlier in the same request.
export async function getIssueRepo(
  supabase: Supabase,
  issueId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("issues")
    .select("projects!inner(repo)")
    .eq("id", issueId)
    .maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }

  return data?.projects.repo ?? null
}

// Like `updateIssueStatusByPrUrl`, but only applies when the issue is
// currently in one of the allowed source statuses. Used by the check webhook
// handlers so CI events don't clobber a status the issue has since moved past
// (e.g. the user already requested changes or merged the PR before CI
// finished).
export async function updateIssueStatusByPrUrlIfStatus(
  supabase: Supabase,
  prUrl: string,
  fromStatus: IssueStatus | readonly IssueStatus[],
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

  const { data: current, error: fetchError } = await (pullRequest
    ? supabase
        .from("issues")
        .select("id,status")
        .eq("id", pullRequest.issue_id)
        .maybeSingle()
    : supabase
        .from("issues")
        .select("id,status")
        .eq("pr_url", prUrl)
        .maybeSingle())

  if (fetchError) {
    throw new ServiceError("internal", fetchError.message)
  }
  if (!current) {
    return null
  }

  const fromStatuses = Array.isArray(fromStatus) ? fromStatus : [fromStatus]
  if (!fromStatuses.includes(current.status)) {
    return null
  }

  const result = unwrap<{ id: string } | null>(
    await supabase
      .from("issues")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", current.id)
      .select("id")
      .maybeSingle()
  )

  if (result) {
    await logIssueEvent(supabase, result.id, "status_changed", {
      from: current.status,
      to: status,
    })
  }

  return result
}

// `ignoreDuplicates` makes this safe to call on every run-state update that
// carries a `pr_url` (the worker resends it on each message), not just the
// first. Only log `pr_opened` when the upsert actually inserted a row —
// `.select()` on an ignored conflict returns no row — so repeat calls for an
// already-tracked PR don't spam the timeline.
export async function attachIssuePullRequest(
  supabase: Supabase,
  issueId: string,
  prUrl: string
) {
  const result = unwrap(
    await supabase
      .from("issue_pull_requests")
      .upsert(
        { issue_id: issueId, url: prUrl },
        { onConflict: "url", ignoreDuplicates: true }
      )
      .select("id")
  )

  if (result.length > 0) {
    await logIssueEvent(supabase, issueId, "pr_opened", { pr_url: prUrl })
  }

  return result
}

// Called from the worker-facing `/agent/issues/[id]/unpublished-changes`
// route whenever the agent commits work without opening a PR itself. Scoped
// to `active_run_id` (a single conditional `UPDATE`, so the check-and-write
// is atomic) so a worker whose run has since finished, been superseded by a
// re-claim, or belongs to a different run entirely can't resurrect state for
// a run it no longer owns.
export async function recordUnpublishedAgentChanges(
  supabase: Supabase,
  userId: string,
  issueId: string,
  runId: string,
  hasUnpublishedAgentChanges: boolean
): Promise<void> {
  await ensureIssueOwned(supabase, userId, issueId)

  const updated = unwrap<{ id: string } | null>(
    await supabase
      .from("issues")
      .update({
        has_unpublished_agent_changes: hasUnpublishedAgentChanges,
        updated_at: new Date().toISOString(),
      })
      .eq("id", issueId)
      .eq("active_run_id", runId)
      .select("id")
      .maybeSingle()
  )

  if (!updated) {
    throw new ServiceError("validation", "Run is not the issue's active run")
  }
}

export type AutomaticPrPublishResult = {
  requestId: string
  messageId: string
  created: boolean
  status: AutomaticPrRequestStatus
  issue: {
    id: string
    code: string
    title: string | null
    activeRunId: string
    createPrAutomatically: boolean
    hasUnpublishedAgentChanges: boolean
    prUrl: string | null
  }
}

// Requests (or, on a duplicate/retried call, returns the already-requested)
// automatic create-PR message for the issue's active run. Only the "at most
// one request per run" and "run must still be active" guarantees are atomic
// — those come from the `request_automatic_pr_publish` RPC's
// unique-constraint-backed insert and its active-run trigger, so they stay
// correct under concurrent callers. The `create_pr_automatically`/`pr_url`/
// `has_unpublished_agent_changes` checks below are a best-effort read here
// in application code, not re-validated by the RPC, so a concurrent change
// to any of them between this read and the RPC call is not guarded against
// — an accepted, narrow race given how rarely those fields change mid-run.
// Nothing here writes `create_pr_automatically`, so it stays `true` after an
// automatic attempt for later auditing (the RPC's insert trigger also
// snapshots it onto the request row).
export async function requestAutomaticPrPublish(
  supabase: Supabase,
  userId: string,
  issueId: string,
  runId: string
): Promise<AutomaticPrPublishResult> {
  await ensureIssueOwned(supabase, userId, issueId)

  const { data: issue, error } = await supabase
    .from("issues")
    .select(
      "id, number, title, active_run_id, create_pr_automatically, has_unpublished_agent_changes, pr_url, projects!inner(key)"
    )
    .eq("id", issueId)
    .maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (!issue) {
    throw new ServiceError("not_found", "Issue not found")
  }
  if (issue.active_run_id !== runId) {
    throw new ServiceError("validation", "Run is not the issue's active run")
  }
  if (!issue.create_pr_automatically) {
    throw new ServiceError(
      "validation",
      "Issue is not opted into automatic PR creation"
    )
  }
  if (issue.pr_url) {
    throw new ServiceError("validation", "Issue already has a pull request")
  }
  if (!issue.has_unpublished_agent_changes) {
    throw new ServiceError(
      "validation",
      "Issue has no unpublished agent changes"
    )
  }

  const code = getIssueCode(issue.projects.key, issue.number)
  const content = formatPublishingRequest({
    branchName: generateFirstPublishBranchName({
      projectKey: issue.projects.key,
      issueNumber: issue.number,
      issueTitle: issue.title,
    }),
  })

  const data = unwrap(
    await supabase
      .rpc("request_automatic_pr_publish", {
        p_issue_id: issueId,
        p_run_id: runId,
        p_content: content,
      })
      .single<{
        request_id: string
        message_id: string
        status: string
        created: boolean
      }>()
  )

  return {
    requestId: data.request_id,
    messageId: data.message_id,
    created: data.created,
    status: data.status as AutomaticPrRequestStatus,
    issue: {
      id: issue.id,
      code,
      title: issue.title,
      activeRunId: runId,
      createPrAutomatically: issue.create_pr_automatically,
      hasUnpublishedAgentChanges: issue.has_unpublished_agent_changes,
      prUrl: issue.pr_url,
    },
  }
}
