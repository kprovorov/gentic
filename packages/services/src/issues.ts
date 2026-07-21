import type {
  AgentProvider,
  CreateIssueValues,
  IssueRelationDirection,
  IssueStatus,
  IssueType,
  UpdateIssueValues,
} from "@gentic/validators/issues"
import type { ChatMessageContract } from "@gentic/validators/realtime"
import type { Tables } from "@gentic/supabase/types"

import { ServiceError, unwrap } from "./errors"
import type { Supabase } from "./types"

const ISSUE_WITH_PROJECT_SELECT = "*, projects!inner(id,name,repo,user_id)"

type IssueRow = Tables<"issues">
type IssueRelationRow = Tables<"issue_relations">
type IssuePullRequestRow = Tables<"issue_pull_requests">

export type IssueRelationIssue = Pick<IssueRow, "id" | "title" | "status">

export type IssueRelation = Pick<
  IssueRelationRow,
  "id" | "source_issue_id" | "target_issue_id" | "created_at"
> & {
  type: "blocks"
  source_issue: IssueRelationIssue
  target_issue: IssueRelationIssue
}

export type IssuePullRequest = Pick<
  IssuePullRequestRow,
  "id" | "issue_id" | "url" | "created_at"
>

export type UserChatMessage = ChatMessageContract & {
  role: "user"
  kind: "text"
  status: "complete"
}

async function ensureProjectOwned(
  supabase: Supabase,
  userId: string,
  projectId: string
) {
  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (!data) {
    throw new ServiceError("not_found", "Project not found")
  }
}

// The `issues` table has no `user_id` of its own, so ownership is checked via
// a join to `projects`, whose `user_id` column does carry the Clerk user id.
export async function ensureIssueOwned(
  supabase: Supabase,
  userId: string,
  issueId: string
) {
  const { data, error } = await supabase
    .from("issues")
    .select("id, projects!inner(user_id)")
    .eq("id", issueId)
    .eq("projects.user_id", userId)
    .maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (!data) {
    throw new ServiceError("not_found", "Issue not found")
  }
}

async function ensureIssuesOwned(
  supabase: Supabase,
  userId: string,
  issueIds: string[]
) {
  const uniqueIds = Array.from(new Set(issueIds))
  const data = unwrap(
    await supabase
      .from("issues")
      .select("id, projects!inner(user_id)")
      .in("id", uniqueIds)
      .eq("projects.user_id", userId)
  )
  if ((data?.length ?? 0) !== uniqueIds.length) {
    throw new ServiceError("not_found", "Issue not found")
  }
}

export async function listIssues(
  supabase: Supabase,
  userId: string,
  filters?: { projectId?: string }
) {
  if (filters?.projectId) {
    await ensureProjectOwned(supabase, userId, filters.projectId)
  }

  let query = supabase
    .from("issues")
    .select(ISSUE_WITH_PROJECT_SELECT)
    .eq("projects.user_id", userId)
    .order("created_at", { ascending: false })

  if (filters?.projectId) {
    query = query.eq("project_id", filters.projectId)
  }

  return unwrap(await query)
}

export async function getIssue(supabase: Supabase, userId: string, id: string) {
  const { data, error } = await supabase
    .from("issues")
    .select(ISSUE_WITH_PROJECT_SELECT)
    .eq("id", id)
    .eq("projects.user_id", userId)
    .maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (!data) {
    throw new ServiceError("not_found", "Issue not found")
  }

  return data
}

export async function listIssueRelationCandidates(
  supabase: Supabase,
  userId: string,
  issueId: string
) {
  await ensureIssueOwned(supabase, userId, issueId)

  return unwrap(
    await supabase
      .from("issues")
      .select("id,title,status,projects!inner(user_id)")
      .eq("projects.user_id", userId)
      .neq("id", issueId)
      .order("created_at", { ascending: false })
  )
}

export async function listIssueRelations(
  supabase: Supabase,
  userId: string,
  issueId: string
): Promise<IssueRelation[]> {
  await ensureIssueOwned(supabase, userId, issueId)

  const relations = unwrap(
    await supabase
      .from("issue_relations")
      .select(
        "id,source_issue_id,target_issue_id,type,created_at,source_issue:issues!issue_relations_source_issue_id_fkey(id,title,status),target_issue:issues!issue_relations_target_issue_id_fkey(id,title,status)"
      )
      .or(`source_issue_id.eq.${issueId},target_issue_id.eq.${issueId}`)
      .order("created_at", { ascending: false })
  )

  return relations.map((relation) => ({
    ...relation,
    type: "blocks",
  }))
}

export async function listIssuePullRequests(
  supabase: Supabase,
  userId: string,
  issueId: string
) {
  await ensureIssueOwned(supabase, userId, issueId)

  return unwrap(
    await supabase
      .from("issue_pull_requests")
      .select("id,issue_id,url,created_at")
      .eq("issue_id", issueId)
      .order("created_at", { ascending: false })
  )
}

export async function listBlockedIssueIds(
  supabase: Supabase,
  issueIds: string[]
) {
  if (issueIds.length === 0) {
    return new Set<string>()
  }

  const data = unwrap(
    await supabase
      .from("issue_relations")
      .select(
        "target_issue_id, source_issue:issues!issue_relations_source_issue_id_fkey(status)"
      )
      .in("target_issue_id", issueIds)
  )

  const blockedIssueIds = new Set<string>()
  for (const relation of data) {
    if (
      relation.source_issue.status !== "completed" &&
      relation.source_issue.status !== "cancelled"
    ) {
      blockedIssueIds.add(relation.target_issue_id)
    }
  }

  return blockedIssueIds
}

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
      status: input.status === "todo" ? "draft" : input.status,
      agent_provider: input.agent_provider,
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
// with no title (see apps/web/app/issues/actions.ts). Runs outside the
// request lifecycle with a service-role client, so there's no `userId` to
// check ownership against — the issue id alone is used, since it was only
// just created by an already-authorized request.
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

// Called from the background type-classification step after an issue is
// saved with the "issue" placeholder type (see apps/web/app/issues/actions.ts).
// Runs outside the request lifecycle with a service-role client, so there's
// no `userId` to check ownership against — the issue id alone is used, since
// it was only just created by an already-authorized request.
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
    .maybeSingle()

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

export async function resetIssueAgent(
  supabase: Supabase,
  userId: string,
  id: string,
  agentProvider: AgentProvider
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
    })
  )

  const message = unwrap(
    await supabase
      .from("messages")
      .select(
        "id,role,kind,content,status,created_at,event_id,run_id,event_type,event_status,event_ts,event_seq,tool_call_id,payload"
      )
      .eq("issue_id", id)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(1)
      .single<UserChatMessage>()
  )

  return message
}

export async function addIssueRelation(
  supabase: Supabase,
  userId: string,
  issueId: string,
  relatedIssueId: string,
  direction: IssueRelationDirection
) {
  if (issueId === relatedIssueId) {
    throw new ServiceError("validation", "An issue cannot relate to itself")
  }

  await ensureIssuesOwned(supabase, userId, [issueId, relatedIssueId])

  const sourceIssueId = direction === "blocking" ? issueId : relatedIssueId
  const targetIssueId = direction === "blocking" ? relatedIssueId : issueId

  const { error } = await supabase.from("issue_relations").insert({
    source_issue_id: sourceIssueId,
    target_issue_id: targetIssueId,
    type: "blocks",
  })

  if (error) {
    if (error.code === "23505") {
      throw new ServiceError("validation", "This relation already exists")
    }
    throw new ServiceError("internal", error.message)
  }
}

export async function deleteIssueRelation(
  supabase: Supabase,
  userId: string,
  relationId: string,
  issueId: string
) {
  await ensureIssueOwned(supabase, userId, issueId)

  const { data: relation, error: fetchError } = await supabase
    .from("issue_relations")
    .select("id,source_issue_id,target_issue_id")
    .eq("id", relationId)
    .or(`source_issue_id.eq.${issueId},target_issue_id.eq.${issueId}`)
    .maybeSingle()

  if (fetchError) {
    throw new ServiceError("internal", fetchError.message)
  }
  if (!relation) {
    throw new ServiceError("not_found", "Relation not found")
  }

  await ensureIssuesOwned(supabase, userId, [
    relation.source_issue_id,
    relation.target_issue_id,
  ])

  unwrap(await supabase.from("issue_relations").delete().eq("id", relationId))
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

  // Moving an issue from Draft to Todo starts an agent run: the remote
  // `@gentic/gentic` agent picks up `status = 'todo'` issues over Supabase
  // and drives the issue's selected coding agent against a fresh clone.
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
// currently in `fromStatus`. Used by the `check_suite` webhook handler so a
// CI result doesn't clobber a status the issue has since moved past (e.g. the
// user already requested changes or merged the PR before CI finished).
export async function updateIssueStatusByPrUrlIfStatus(
  supabase: Supabase,
  prUrl: string,
  fromStatus: IssueStatus,
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
        .eq("status", fromStatus)
        .select("id")
        .maybeSingle()
    )
  }

  return unwrap(
    await supabase
      .from("issues")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("pr_url", prUrl)
      .eq("status", fromStatus)
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

export async function sendIssueMessage(
  supabase: Supabase,
  userId: string,
  issueId: string,
  content: string
) {
  await ensureIssueOwned(supabase, userId, issueId)

  return unwrap(
    await supabase
      .rpc("send_issue_user_message", {
        p_issue_id: issueId,
        p_content: content,
      })
      .single<{ id: string; created_at: string }>()
  )
}

export async function createIssueUserMessage(
  supabase: Supabase,
  issueId: string,
  content: string
) {
  const message = unwrap(
    await supabase
      .from("messages")
      .insert({
        issue_id: issueId,
        role: "user",
        content,
      })
      .select("id, created_at")
      .single<{ id: string; created_at: string }>()
  )

  return message
}

export async function deleteIssueMessage(
  supabase: Supabase,
  issueId: string,
  messageId: string
) {
  unwrap(
    await supabase
      .from("messages")
      .delete()
      .eq("issue_id", issueId)
      .eq("id", messageId)
  )
}

export async function requeueIssueForUserMessage(
  supabase: Supabase,
  issueId: string
) {
  unwrap(
    await supabase
      .from("issues")
      .update({
        status: "todo",
        usage_limit_reset_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", issueId)
      .not("status", "in", "(draft,todo,queued,held,in-progress)")
  )
}

export type ChangesRequestedReviewComment = {
  path: string
  line: number | null
  diffHunk: string
  body: string
}

export type ChangesRequestedReview = {
  id: number
  reviewerLogin: string
  body: string | null
  comments: ChangesRequestedReviewComment[]
}

function formatChangesRequestedMessage(
  prUrl: string,
  review: ChangesRequestedReview
): string {
  const lines = [
    `@${review.reviewerLogin} requested changes on ${prUrl}.`,
    "Push fixes to the same branch — do not open a new pull request.",
  ]

  if (review.body) {
    lines.push("", review.body)
  }

  for (const comment of review.comments) {
    lines.push(
      "",
      `**${comment.path}:${comment.line ?? "?"}**`,
      "```diff",
      comment.diffHunk,
      "```",
      comment.body
    )
  }

  return lines.join("\n")
}

// Called from the GitHub webhook route (trusted, HMAC-authenticated server
// code — no `userId`) when a review comes back as "changes requested". Feeds
// the review back into the issue's transcript and re-queues the run so the
// same agent session picks up the feedback, instead of leaving the issue
// sitting in `changes-requested` until a human re-triggers it.
export async function applyChangesRequestedReview(
  supabase: Supabase,
  prUrl: string,
  review: ChangesRequestedReview
) {
  const { data: issue, error } = await supabase
    .from("issues")
    .select("id, projects!inner(auto_respond_to_reviews)")
    .eq("pr_url", prUrl)
    .maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  // No issue tracks this PR, or the project opted out — leave the
  // status-only behavior the webhook route already applied in place.
  if (!issue || !issue.projects.auto_respond_to_reviews) {
    return
  }

  const { error: insertError } = await supabase.from("messages").insert({
    issue_id: issue.id,
    role: "user",
    content: formatChangesRequestedMessage(prUrl, review),
    github_review_id: review.id,
  })

  if (insertError) {
    // Unique violation on (issue_id, github_review_id): GitHub redelivered
    // a webhook we already processed. Skip both the insert and the requeue.
    if (insertError.code === "23505") {
      return
    }
    throw new ServiceError("internal", insertError.message)
  }

  // The webhook route already flipped `status` to `changes-requested` via
  // `updateIssueStatusByPrUrl` right before calling this — re-queue from
  // there so the same agent session picks the review back up.
  unwrap(
    await supabase
      .from("issues")
      .update({
        status: "todo",
        usage_limit_reset_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", issue.id)
      .eq("status", "changes-requested")
  )
}
