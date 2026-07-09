import { createHmac, timingSafeEqual } from "node:crypto"

import { createServiceClient } from "@gentic/supabase/service"
import * as issuesService from "@gentic/services/issues"
import type { IssueStatus } from "@gentic/validators/issues"

import { fetchPullRequestReviewComments } from "@/lib/github-app"

export const runtime = "nodejs"

type PullRequestPayload = {
  action: string
  pull_request: {
    html_url: string
    merged: boolean
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
  let status: IssueStatus | null = null

  if (payload.action === "closed") {
    status = payload.pull_request.merged ? "merged" : "cancelled"
  } else if (payload.action === "reopened") {
    status = "ready-for-review"
  }

  if (!status) {
    return
  }

  await issuesService.updateIssueStatusByPrUrl(
    supabase,
    payload.pull_request.html_url,
    status
  )
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
  let comments: Awaited<
    ReturnType<typeof fetchPullRequestReviewComments>
  > = []

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
