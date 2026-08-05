import { createHmac, timingSafeEqual } from "node:crypto"

import { createServiceClient } from "@gentic/supabase/service"
import * as issuesService from "@gentic/services/issues"
import type { IssueStatus } from "@gentic/validators/issues"

import { resolveCheckSuiteStatus } from "@/lib/ci-status"
import {
  fetchCheckSuitesForRef,
  fetchPullRequestNumbersForCommit,
  fetchPullRequestReviewComments,
  resolvePullRequestState,
} from "@/lib/github-app"

export const runtime = "nodejs"

type PullRequestPayload = {
  action: string
  pull_request: {
    html_url: string
    state: string
    draft: boolean
    merged: boolean
    merged_at: string | null
  }
}

type CheckSuitePayload = {
  action: string
  check_suite: {
    head_sha: string
    status: string
    conclusion: string | null
    pull_requests?: { number: number }[]
  }
  repository: {
    name: string
    owner: {
      login: string
    }
  }
  installation?: {
    id: number
  }
}

type CheckRunPayload = {
  action: string
  check_run: {
    head_sha: string
    status: string
    conclusion: string | null
    pull_requests?: { number: number }[]
  }
  repository: {
    name: string
    owner: {
      login: string
    }
  }
  installation?: {
    id: number
  }
}

type WorkflowRunPayload = {
  action: string
  workflow_run: {
    head_sha: string
    pull_requests?: { number: number }[]
  }
  repository: {
    name: string
    owner: {
      login: string
    }
  }
  installation?: {
    id: number
  }
}

type PullRequestReviewPayload = {
  action: string
  review: {
    id: number
    state: string
    body: string | null
    user: {
      login: string
    }
  }
  pull_request: {
    html_url: string
    number: number
  }
  repository: {
    name: string
    owner: {
      login: string
    }
  }
  installation?: {
    id: number
  }
}

type IssueCommentPayload = {
  action: string
  issue: {
    number: number
    pull_request?: unknown
  }
  comment: {
    id: number
    body: string
    html_url: string
    user: {
      login: string
    }
  }
  repository: {
    name: string
    owner: {
      login: string
    }
  }
}

type PullRequestReviewCommentPayload = {
  action: string
  comment: {
    id: number
    path: string
    line: number | null
    original_line: number | null
    diff_hunk: string
    body: string
    html_url: string
    user: {
      login: string
    }
  }
  pull_request: {
    html_url: string
  }
}

export async function POST(request: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET

  if (!secret) {
    console.error("[github-webhook] GITHUB_WEBHOOK_SECRET is not configured")
    return new Response("Webhook not configured", { status: 503 })
  }

  const body = await request.text()
  const signature = request.headers.get("x-hub-signature-256")

  if (!verifySignature(body, signature, secret)) {
    return new Response("Invalid signature", { status: 401 })
  }

  const event = request.headers.get("x-github-event")
  const payload = JSON.parse(body)

  const supabase = createServiceClient()

  if (event === "pull_request") {
    await handlePullRequestEvent(supabase, payload as PullRequestPayload)
  } else if (event === "pull_request_review") {
    await handlePullRequestReviewEvent(
      supabase,
      payload as PullRequestReviewPayload
    )
  } else if (event === "issue_comment") {
    await handleIssueCommentEvent(supabase, payload as IssueCommentPayload)
  } else if (event === "pull_request_review_comment") {
    await handlePullRequestReviewCommentEvent(
      supabase,
      payload as PullRequestReviewCommentPayload
    )
  } else if (event === "check_suite") {
    await handleCheckSuiteEvent(supabase, payload as CheckSuitePayload)
  } else if (event === "check_run") {
    await handleCheckRunEvent(supabase, payload as CheckRunPayload)
  } else if (event === "workflow_run") {
    await handleWorkflowRunEvent(supabase, payload as WorkflowRunPayload)
  }

  return Response.json({ ok: true })
}

function verifySignature(
  body: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) {
    return false
  }

  const expected =
    "sha256=" + createHmac("sha256", secret).update(body).digest("hex")

  const expectedBuffer = Buffer.from(expected)
  const signatureBuffer = Buffer.from(signature)

  if (expectedBuffer.length !== signatureBuffer.length) {
    return false
  }

  return timingSafeEqual(expectedBuffer, signatureBuffer)
}

async function handlePullRequestEvent(
  supabase: ReturnType<typeof createServiceClient>,
  payload: PullRequestPayload
) {
  // The payload always carries the PR's full current state regardless of
  // action, so every delivery is a chance to refresh the cached pill state
  // without ever polling the GitHub API. Buffer it by URL (survives deliveries
  // that arrive before the PR is attached to an issue — the worker only
  // attaches at run finish) and update the attached row directly so later
  // transitions land immediately.
  const prState = resolvePullRequestState(payload.pull_request)
  if (prState !== "unknown") {
    await issuesService.recordPullRequestState(
      supabase,
      payload.pull_request.html_url,
      prState
    )
    await issuesService.updatePullRequestStateByPrUrl(
      supabase,
      payload.pull_request.html_url,
      prState
    )
  }

  let status: IssueStatus | null = null

  if (payload.action === "closed") {
    status = payload.pull_request.merged ? "merged" : "cancelled"
  } else if (payload.action === "reopened") {
    status = "ready-for-review"
  }

  if (!status) {
    return
  }

  const result = await issuesService.updateIssueStatusByPrUrl(
    supabase,
    payload.pull_request.html_url,
    status
  )

  if (result && payload.pull_request.merged) {
    await issuesService.logIssueEvent(supabase, result.id, "pr_merged", {
      pr_url: payload.pull_request.html_url,
    })
  }
}

async function handleIssueCommentEvent(
  supabase: ReturnType<typeof createServiceClient>,
  payload: IssueCommentPayload
) {
  if (payload.action !== "created" || !isPullRequestIssue(payload)) {
    return
  }

  const prUrl = `https://github.com/${payload.repository.owner.login}/${payload.repository.name}/pull/${payload.issue.number}`

  await issuesService.applyPullRequestComment(supabase, prUrl, {
    id: payload.comment.id,
    commenterLogin: payload.comment.user.login,
    body: payload.comment.body,
    htmlUrl: payload.comment.html_url,
  })
}

async function handlePullRequestReviewCommentEvent(
  supabase: ReturnType<typeof createServiceClient>,
  payload: PullRequestReviewCommentPayload
) {
  if (payload.action !== "created") {
    return
  }

  await issuesService.applyPullRequestComment(
    supabase,
    payload.pull_request.html_url,
    {
      id: payload.comment.id,
      commenterLogin: payload.comment.user.login,
      body: payload.comment.body,
      htmlUrl: payload.comment.html_url,
      path: payload.comment.path,
      line: payload.comment.line ?? payload.comment.original_line,
      diffHunk: payload.comment.diff_hunk,
    }
  )
}

export function isPullRequestIssue(
  payload: Pick<IssueCommentPayload, "issue">
): boolean {
  return Boolean(payload.issue.pull_request)
}

// A commit can have several check suites (GitHub Actions plus any other CI
// apps), each delivering its own webhook as it starts and completes.
// Pending events move reviewable PRs back to `testing`; completed events
// re-fetch the full set for the head SHA so we only resolve `testing` once
// every suite is done, rather than acting on the first one to finish.
async function handleCheckSuiteEvent(
  supabase: ReturnType<typeof createServiceClient>,
  payload: CheckSuitePayload
) {
  if (
    payload.action !== "completed" &&
    !isPendingCheckAction("check_suite", payload.action)
  ) {
    return
  }

  const installationId = payload.installation?.id
  if (!installationId) {
    return
  }

  const owner = payload.repository.owner.login
  const repo = payload.repository.name

  const resolveChecks =
    payload.action === "completed"
      ? resolveCompletedChecksForRef
      : markPendingChecksForRef

  await resolveChecks(
    supabase,
    String(installationId),
    owner,
    repo,
    payload.check_suite.head_sha,
    payload.check_suite.pull_requests?.map((pullRequest) => pullRequest.number)
  )
}

async function handleCheckRunEvent(
  supabase: ReturnType<typeof createServiceClient>,
  payload: CheckRunPayload
) {
  if (
    payload.action !== "completed" &&
    !isPendingCheckAction("check_run", payload.action)
  ) {
    return
  }

  const installationId = payload.installation?.id
  if (!installationId) {
    return
  }

  const owner = payload.repository.owner.login
  const repo = payload.repository.name

  const resolveChecks =
    payload.action === "completed"
      ? resolveCompletedChecksForRef
      : markPendingChecksForRef

  await resolveChecks(
    supabase,
    String(installationId),
    owner,
    repo,
    payload.check_run.head_sha,
    payload.check_run.pull_requests?.map((pullRequest) => pullRequest.number)
  )
}

async function handleWorkflowRunEvent(
  supabase: ReturnType<typeof createServiceClient>,
  payload: WorkflowRunPayload
) {
  if (
    payload.action !== "completed" &&
    !isPendingCheckAction("workflow_run", payload.action)
  ) {
    return
  }

  const installationId = payload.installation?.id
  if (!installationId) {
    return
  }

  const owner = payload.repository.owner.login
  const repo = payload.repository.name

  const resolveChecks =
    payload.action === "completed"
      ? resolveCompletedChecksForRef
      : markPendingChecksForRef

  await resolveChecks(
    supabase,
    String(installationId),
    owner,
    repo,
    payload.workflow_run.head_sha,
    getWorkflowRunPullNumbers(payload)
  )
}

export function getWorkflowRunPullNumbers(
  payload: Pick<WorkflowRunPayload, "workflow_run">
): number[] {
  return (
    payload.workflow_run.pull_requests?.map(
      (pullRequest) => pullRequest.number
    ) ?? []
  )
}

export function isPendingCheckAction(
  event: "check_suite" | "check_run" | "workflow_run",
  action: string
): boolean {
  if (event === "workflow_run") {
    return action === "requested"
  }

  return action === "rerequested"
}

async function resolveCompletedChecksForRef(
  supabase: ReturnType<typeof createServiceClient>,
  installationId: string,
  owner: string,
  repo: string,
  headSha: string,
  fallbackPullNumbers: number[] = []
) {
  const pullNumbers = await resolvePullNumbersForRef(
    installationId,
    owner,
    repo,
    headSha,
    fallbackPullNumbers
  )

  if (pullNumbers.length === 0) {
    console.error(
      "[github-webhook] could not resolve pull requests for completed checks, skipping"
    )
    return
  }

  let suites
  try {
    suites = await fetchCheckSuitesForRef(installationId, owner, repo, headSha)
  } catch (error) {
    console.error(
      "[github-webhook] failed to fetch check suites for ref, skipping:",
      error
    )
    return
  }

  const status = resolveCheckSuiteStatus(suites)

  if (status === "testing") {
    return
  }

  // The commit is pushed before the PR is opened, so the very first
  // check_suite/workflow_run "requested" event can arrive before any PR
  // exists for the ref — `markPendingChecksForRef` then has no PR to move to
  // `testing`, and the run can finish and land straight on `ready-for-review`
  // (see `resolvePrFinishStatus`) before the checks it raced against
  // complete. Accept those statuses here too so the completed event still
  // corrects them instead of no-op'ing against a `testing` guard that was
  // never set.
  for (const pullNumber of pullNumbers) {
    const prUrl = `https://github.com/${owner}/${repo}/pull/${pullNumber}`
    const result = await issuesService.updateIssueStatusByPrUrlIfStatus(
      supabase,
      prUrl,
      ["testing", "ready-for-review", "tests-failed"],
      status
    )

    if (result && status === "tests-failed") {
      await issuesService.applyTestsFailed(supabase, result.id, prUrl)
    }
  }
}

async function resolvePullNumbersForRef(
  installationId: string,
  owner: string,
  repo: string,
  headSha: string,
  fallbackPullNumbers: number[] = []
) {
  // The payload's own `check_suite.pull_requests` is only populated when the
  // PR was already open at the moment the check suite was created. The
  // worker pushes commits (creating the check suite) before opening the PR,
  // so that array is unreliable here — resolve PRs from the commit SHA via
  // the API instead.
  let pullNumbers: number[]
  try {
    pullNumbers = await fetchPullRequestNumbersForCommit(
      installationId,
      owner,
      repo,
      headSha
    )
  } catch (error) {
    console.error(
      "[github-webhook] failed to fetch pull requests for commit, falling back to payload:",
      error
    )
    pullNumbers = fallbackPullNumbers
  }

  return pullNumbers.length > 0 ? pullNumbers : fallbackPullNumbers
}

async function markPendingChecksForRef(
  supabase: ReturnType<typeof createServiceClient>,
  installationId: string,
  owner: string,
  repo: string,
  headSha: string,
  fallbackPullNumbers: number[] = []
) {
  const pullNumbers = await resolvePullNumbersForRef(
    installationId,
    owner,
    repo,
    headSha,
    fallbackPullNumbers
  )

  for (const pullNumber of pullNumbers) {
    const prUrl = `https://github.com/${owner}/${repo}/pull/${pullNumber}`
    await issuesService.updateIssueStatusByPrUrlIfStatus(
      supabase,
      prUrl,
      ["ready-for-review", "tests-failed"],
      "testing"
    )
  }
}

async function handlePullRequestReviewEvent(
  supabase: ReturnType<typeof createServiceClient>,
  payload: PullRequestReviewPayload
) {
  if (payload.action !== "submitted") {
    return
  }

  let status: IssueStatus | null = null

  if (payload.review.state === "approved") {
    status = "approved"
  } else if (payload.review.state === "changes_requested") {
    status = "changes-requested"
  }

  if (!status) {
    return
  }

  await issuesService.updateIssueStatusByPrUrl(
    supabase,
    payload.pull_request.html_url,
    status
  )

  if (payload.review.state === "changes_requested") {
    await applyChangesRequestedReview(supabase, payload)
  }
}

// Fetches the review's inline comments (not present on the webhook payload
// itself) and feeds the whole review back to the issue's agent session. Never
// throws past this point — a comment-fetch failure falls back to the review
// body alone rather than dropping the event.
async function applyChangesRequestedReview(
  supabase: ReturnType<typeof createServiceClient>,
  payload: PullRequestReviewPayload
) {
  let comments: Awaited<ReturnType<typeof fetchPullRequestReviewComments>> = []

  const installationId = payload.installation?.id

  if (installationId) {
    try {
      comments = await fetchPullRequestReviewComments(
        String(installationId),
        payload.repository.owner.login,
        payload.repository.name,
        payload.pull_request.number,
        payload.review.id
      )
    } catch (error) {
      console.error(
        "[github-webhook] failed to fetch review comments, falling back to review body only",
        error
      )
    }
  }

  await issuesService.applyChangesRequestedReview(
    supabase,
    payload.pull_request.html_url,
    {
      id: payload.review.id,
      reviewerLogin: payload.review.user.login,
      body: payload.review.body,
      comments: comments.map((comment) => ({
        path: comment.path,
        line: comment.line,
        diffHunk: comment.diff_hunk,
        body: comment.body,
      })),
    }
  )
}
