import { ServiceError, unwrap } from "../errors"
import type { Supabase } from "../types"
import { ensureIssueOwned } from "./ownership"

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

// Called from the GitHub webhook route when a review comes back as "changes
// requested". Feeds the review into the transcript and re-queues the run so
// the same agent session can address it.
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
