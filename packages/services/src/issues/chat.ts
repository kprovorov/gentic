import { ServiceError, unwrap } from "../errors"
import type { Supabase } from "../types"
import { ensureIssueOwned } from "./ownership"
import {
  formatPublishingRequest,
  generateFirstPublishBranchName,
} from "./publish"

export const GENTIC_AUTHORED_USER_MESSAGE = {
  role: "user",
  author_type: "gentic",
} as const

const manualCreatePrFinishedStatuses = new Set([
  "waiting-for-input",
  "tests-failed",
  "ready-for-review",
  "run-failed",
])

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
  return unwrap(
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
}

export async function createManualFirstPrPublishMessage(
  supabase: Supabase,
  userId: string,
  issueId: string
) {
  await ensureIssueOwned(supabase, userId, issueId)

  const { data: issue, error } = await supabase
    .from("issues")
    .select(
      "id, number, title, status, has_unpublished_agent_changes, projects!inner(key)"
    )
    .eq("id", issueId)
    .maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (!issue) {
    throw new ServiceError("not_found", "Issue not found")
  }
  if (!manualCreatePrFinishedStatuses.has(issue.status)) {
    throw new ServiceError("validation", "Agent is not idle after finishing")
  }
  if (!issue.has_unpublished_agent_changes) {
    throw new ServiceError(
      "validation",
      "Issue has no unpublished agent changes"
    )
  }
  const pullRequests = unwrap(
    await supabase
      .from("issue_pull_requests")
      .select("id")
      .eq("issue_id", issueId)
      .limit(1)
  )
  if (pullRequests.length > 0) {
    throw new ServiceError("validation", "Issue already has a pull request")
  }

  // The run that requested this is already finished by the time a manual
  // create-PR click reaches here (`finish_issue_run_if_no_pending` clears
  // `active_run_id` in the same update that lands a finished status), so
  // there is no current run id left to scope this by — check across all
  // runs for the issue instead.
  const automaticRequests = unwrap(
    await supabase
      .from("issue_automatic_pr_requests")
      .select("id")
      .eq("issue_id", issueId)
      .in("status", ["pending", "claimed"])
      .limit(1)
  )
  if (automaticRequests.length > 0) {
    throw new ServiceError("validation", "Automatic PR publishing is running")
  }

  const branchName = generateFirstPublishBranchName({
    projectKey: issue.projects.key,
    issueNumber: issue.number,
    issueTitle: issue.title,
  })
  const content = formatPublishingRequest({ branchName })
  const existingManualRequest = await getManualFirstPrPublishMessage(
    supabase,
    issueId
  )

  if (existingManualRequest) {
    return { ...existingManualRequest, content, created: false }
  }

  const insertResult = await supabase
    .from("messages")
    .insert({
      issue_id: issueId,
      role: "user",
      kind: "text",
      content,
      author_type: "user",
      generated_action: "create_pr",
    })
    .select("id, created_at")
    .single<{ id: string; created_at: string }>()

  if (insertResult.error) {
    if ("code" in insertResult.error && insertResult.error.code === "23505") {
      const duplicate = await getManualFirstPrPublishMessage(supabase, issueId)
      if (duplicate) {
        return { ...duplicate, content, created: false }
      }
    }
    throw new ServiceError("internal", insertResult.error.message)
  }

  const message = insertResult.data

  try {
    await requeueIssueForUserMessage(supabase, issueId)
  } catch (error) {
    await deleteIssueMessage(supabase, issueId, message.id).catch(
      (cleanupError) => {
        console.error(
          `Failed to clean up manual create PR message ${message.id}:`,
          cleanupError
        )
      }
    )
    throw error
  }

  return { ...message, content, created: true }
}

async function getManualFirstPrPublishMessage(
  supabase: Supabase,
  issueId: string
) {
  return unwrap(
    await supabase
      .from("messages")
      .select("id, created_at")
      .eq("issue_id", issueId)
      .eq("role", "user")
      .eq("author_type", "user")
      .eq("generated_action", "create_pr")
      .order("created_at", { ascending: false })
      .limit(1)
  )[0]
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

export type PullRequestComment = {
  id: number
  commenterLogin: string
  body: string
  htmlUrl: string | null
  path?: string | null
  line?: number | null
  diffHunk?: string | null
}

export function formatChangesRequestedMessage(
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

export function formatPullRequestCommentMessage(
  prUrl: string,
  comment: PullRequestComment
): string {
  const location = comment.path
    ? ` on ${comment.path}:${comment.line ?? "?"}`
    : ""
  const lines = [
    `@${comment.commenterLogin} commented${location} on ${prUrl}.`,
    "Push fixes to the same branch if this comment requests a code change — do not open a new pull request.",
  ]

  if (comment.htmlUrl) {
    lines.push("", comment.htmlUrl)
  }

  if (comment.diffHunk) {
    lines.push("", "```diff", comment.diffHunk, "```")
  }

  lines.push("", comment.body)

  return lines.join("\n")
}

export function formatTestsFailedMessage(prUrl: string): string {
  return [
    `GitHub tests failed on ${prUrl}.`,
    "Inspect the failing checks, push fixes to the same branch, and do not open a new pull request.",
  ].join("\n")
}

// Called from the GitHub webhook route when a review comes back as "changes
// requested". Feeds the review into the transcript and re-queues the run so
// the same agent session can address it.
export async function applyChangesRequestedReview(
  supabase: Supabase,
  prUrl: string,
  review: ChangesRequestedReview
) {
  const issue = await getIssueForPullRequestFeedback(supabase, prUrl)
  if (!issue || !issue.projects.auto_respond_to_reviews) {
    return
  }

  const { error: insertError } = await supabase.from("messages").insert({
    issue_id: issue.id,
    ...GENTIC_AUTHORED_USER_MESSAGE,
    content: formatChangesRequestedMessage(prUrl, review),
    github_review_id: review.id,
  })

  if (insertError) {
    if (insertError.code === "23505") {
      return
    }
    throw new ServiceError("internal", insertError.message)
  }

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

// Called from the GitHub webhook route when a PR conversation comment or
// standalone inline review comment is created. Feeds the comment into the
// transcript and re-queues ended runs so the agent can react to PR feedback
// that was not submitted as a "changes requested" review.
export async function applyPullRequestComment(
  supabase: Supabase,
  prUrl: string,
  comment: PullRequestComment
) {
  const issue = await getIssueForPullRequestFeedback(supabase, prUrl)
  if (!issue || !issue.projects.auto_respond_to_reviews) {
    return
  }

  const { error: insertError } = await supabase.from("messages").insert({
    issue_id: issue.id,
    role: "user",
    content: formatPullRequestCommentMessage(prUrl, comment),
    github_comment_id: comment.id,
  })

  if (insertError) {
    if (insertError.code === "23505") {
      return
    }
    throw new ServiceError("internal", insertError.message)
  }

  unwrap(
    await supabase
      .from("issues")
      .update({
        status: "todo",
        usage_limit_reset_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", issue.id)
      .not("status", "in", "(draft,todo,queued,held,in-progress)")
  )
}

async function getIssueForPullRequestFeedback(
  supabase: Supabase,
  prUrl: string
) {
  const { data: pullRequest, error: pullRequestError } = await supabase
    .from("issue_pull_requests")
    .select("issue_id")
    .eq("url", prUrl)
    .maybeSingle()

  if (pullRequestError) {
    throw new ServiceError("internal", pullRequestError.message)
  }
  if (!pullRequest) {
    return null
  }

  const { data: issue, error: issueError } = await supabase
    .from("issues")
    .select("id, projects!inner(auto_respond_to_reviews)")
    .eq("id", pullRequest.issue_id)
    .maybeSingle()

  if (issueError) {
    throw new ServiceError("internal", issueError.message)
  }

  return issue
}

// Called from the GitHub webhook route when CI fails after a PR run. The
// status transition is guarded by the webhook handler, so this can safely
// enqueue the follow-up prompt once per testing -> tests-failed transition.
export async function applyTestsFailed(
  supabase: Supabase,
  issueId: string,
  prUrl: string
) {
  unwrap(
    await supabase.from("messages").insert({
      issue_id: issueId,
      ...GENTIC_AUTHORED_USER_MESSAGE,
      content: formatTestsFailedMessage(prUrl),
    })
  )

  unwrap(
    await supabase
      .from("issues")
      .update({
        status: "todo",
        usage_limit_reset_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", issueId)
      .eq("status", "tests-failed")
  )
}
