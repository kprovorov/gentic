import { ISSUE_ATTACHMENT_KIND } from "./attachments"
import { ServiceError } from "./errors"
import { getIssueCode } from "./issues/shared"
import type { Supabase } from "./types"

const ATTACHMENTS_BUCKET = "attachments"
// Short-lived, minted on demand each time context is assembled — the same
// tradeoff `ATTACHMENT_DOWNLOAD_URL_TTL_SECONDS` in attachments.ts makes.
const ATTACHMENT_URL_TTL_SECONDS = 300

export type ReviewRunContextAttachment = {
  id: string
  fileName: string
  contentType: string | null
  sizeBytes: number | null
  url: string
}

export type ReviewRunPullRequestState = {
  url: string
  headSha: string
  ciState: "unknown" | "pending" | "success" | "failure"
}

export type ReviewRunContext = {
  issue: {
    code: string
    title: string | null
    body: string | null
  }
  attachments: ReviewRunContextAttachment[]
  repo: string
  reviewerProvider: "claude_code" | "codex"
  reviewerModel: string | null
  reviewerInstructions: string | null
  pullRequest: ReviewRunPullRequestState
}

/**
 * Everything the isolated reviewer process (GEN-415) is given, minus the pull
 * request's own title/body/base ref — those live on GitHub, not in this
 * database. The agent-API route (the only place with GitHub App credentials)
 * fetches them separately and merges them into the full payload it returns to
 * the worker. `reviewerProvider`/`reviewerModel`/`reviewerInstructions` come
 * straight from the frozen `issue_review_policies` row: "Same as Issue"
 * resolution already happened at policy-snapshot time
 * (`snapshot_issue_review_policy`, see
 * `20260819120100_add_automatic_review_configuration.sql`), so this is a
 * plain read, never a re-resolution.
 */
export async function getReviewRunContext(
  supabase: Supabase,
  reviewRunId: string
): Promise<ReviewRunContext> {
  const runResult = await supabase
    .from("review_runs")
    .select(
      `
      review_cycles!inner (
        issue_id,
        issue_pull_requests!inner ( url, head_sha, ci_state ),
        issues!inner (
          number,
          title,
          body,
          projects!inner ( key, repo )
        )
      )
      `
    )
    .eq("id", reviewRunId)
    .maybeSingle()

  const { data: run, error: runError } = runResult as {
    data: {
      review_cycles: {
        issue_id: string
        issue_pull_requests: {
          url: string
          head_sha: string | null
          ci_state: "unknown" | "pending" | "success" | "failure"
        }
        issues: {
          number: number
          title: string | null
          body: string | null
          projects: { key: string; repo: string }
        }
      }
    } | null
    error: { message: string } | null
  }

  if (runError) {
    throw new ServiceError("internal", runError.message)
  }
  if (!run) {
    throw new ServiceError("not_found", "Review run not found")
  }

  const {
    issue_id: issueId,
    issue_pull_requests: pullRequest,
    issues: issue,
  } = run.review_cycles

  if (!pullRequest.head_sha) {
    throw new ServiceError(
      "internal",
      "Review run's pull request has no head SHA on record"
    )
  }

  const policyResult = await supabase
    .from("issue_review_policies")
    .select("reviewer_provider, reviewer_model, reviewer_instructions")
    .eq("issue_id", issueId)
    .maybeSingle()

  const { data: policy, error: policyError } = policyResult as {
    data: {
      reviewer_provider: "claude_code" | "codex"
      reviewer_model: string | null
      reviewer_instructions: string | null
    } | null
    error: { message: string } | null
  }

  if (policyError) {
    throw new ServiceError("internal", policyError.message)
  }
  if (!policy) {
    throw new ServiceError(
      "internal",
      "Review run's issue has no frozen review policy"
    )
  }

  return {
    issue: {
      code: getIssueCode(issue.projects.key, issue.number),
      title: issue.title,
      body: issue.body,
    },
    attachments: await getReviewRunContextAttachments(supabase, issueId),
    repo: issue.projects.repo,
    reviewerProvider: policy.reviewer_provider,
    reviewerModel: policy.reviewer_model,
    reviewerInstructions: policy.reviewer_instructions,
    pullRequest: {
      url: pullRequest.url,
      headSha: pullRequest.head_sha,
      ciState: pullRequest.ci_state,
    },
  }
}

/**
 * The issue's durable attachments (kind = issue, not tied to a chat message),
 * signed for direct download — the same query shape
 * `listWorkerIssueAttachments` uses for the implementation agent's `message_
 * id === null` case, in `apps/web/app/api/v1/agent/issues/[id]/attachments/
 * route.ts`.
 */
async function getReviewRunContextAttachments(
  supabase: Supabase,
  issueId: string
): Promise<ReviewRunContextAttachment[]> {
  const { data, error } = await supabase
    .from("attachments")
    .select("id,file_name,content_type,size_bytes,storage_path")
    .eq("issue_id", issueId)
    .eq("kind", ISSUE_ATTACHMENT_KIND)
    .is("message_id", null)
    .is("deleted_at", null)
    .not("upload_completed_at", "is", null)
    .order("created_at", { ascending: true })

  if (error) {
    throw new ServiceError("internal", error.message)
  }

  return Promise.all(
    (data ?? []).map(async (attachment) => {
      const { data: signed, error: signError } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .createSignedUrl(attachment.storage_path, ATTACHMENT_URL_TTL_SECONDS)

      if (signError || !signed) {
        throw new ServiceError(
          "internal",
          signError?.message ?? "Could not sign attachment download URL"
        )
      }

      return {
        id: attachment.id,
        fileName: attachment.file_name,
        contentType: attachment.content_type,
        sizeBytes: attachment.size_bytes,
        url: signed.signedUrl,
      }
    })
  )
}

export type ReviewRunPublishContext = {
  repo: string
  prUrl: string
  // `review_runs.head_sha`, not `issue_pull_requests.head_sha` — the SHA
  // this specific run's verdict was produced against, frozen at run
  // creation. `issue_pull_requests.head_sha` can already have moved by
  // publish time if a new push landed mid-review; comparing against it
  // instead would let a stale verdict slip through as if it were current.
  headSha: string
}

/**
 * Everything GEN-416's publish step needs to place a GitHub review: which
 * repo/pull-request to post to, and the exact commit the verdict is about
 * (for the caller's live-head-SHA staleness guard). Deliberately separate
 * from `getReviewRunContext` (the reviewer's own input payload), which reads
 * `issue_pull_requests.head_sha` for a different purpose — the PR's current
 * state, not the frozen commit a completed run's verdict is pinned to.
 */
export async function getReviewRunPublishContext(
  supabase: Supabase,
  reviewRunId: string
): Promise<ReviewRunPublishContext> {
  const runResult = await supabase
    .from("review_runs")
    .select(
      `
      head_sha,
      review_cycles!inner (
        issue_pull_requests!inner ( url ),
        issues!inner ( projects!inner ( repo ) )
      )
      `
    )
    .eq("id", reviewRunId)
    .maybeSingle()

  const { data: run, error: runError } = runResult as {
    data: {
      head_sha: string
      review_cycles: {
        issue_pull_requests: { url: string }
        issues: { projects: { repo: string } }
      }
    } | null
    error: { message: string } | null
  }

  if (runError) {
    throw new ServiceError("internal", runError.message)
  }
  if (!run) {
    throw new ServiceError("not_found", "Review run not found")
  }

  return {
    repo: run.review_cycles.issues.projects.repo,
    prUrl: run.review_cycles.issue_pull_requests.url,
    headSha: run.head_sha,
  }
}
