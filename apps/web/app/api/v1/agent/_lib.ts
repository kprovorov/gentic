import { ServiceError } from "@gentic/services/errors"
import { ensureIssueOwned } from "@gentic/services/issues"
import { authenticateHostCredential } from "@gentic/services/hosts"
import { createServiceClient } from "@gentic/supabase/service"
import {
  ackMessagesInputSchema,
  finishRunFieldsSchema,
  insertMessageInputShape,
  recordUnpublishedChangesInputSchema,
  requestAutomaticPrPublishInputSchema,
  realtimeTokenInputSchema,
  requireGenticGeneratedActionAuthor,
  runStateFieldsSchema,
} from "@gentic/validators/agent"
import { issueStatusSchema } from "@gentic/validators/issues"
import { z } from "zod"

export { ensureIssueOwned }

export type Supabase = ReturnType<typeof createServiceClient>

// The statuses a host run is allowed to move an issue into via `/run-state`.
// Everything else (e.g. `merged`, `approved`) is set by the user or the
// GitHub webhook, not the agent run itself.
export const runStateSchema = runStateFieldsSchema
export const runStateStatusSchema = issueStatusSchema.extract([
  "in-progress",
  "held",
  "run-failed",
  "ready-for-review",
  "waiting-for-input",
])

export const finishRunSchema = finishRunFieldsSchema
  .extend({
    finish_if_no_pending: z.literal(true),
  })
  .strict()

export const ackMessagesSchema = ackMessagesInputSchema
export const insertMessageSchema = z
  .object(insertMessageInputShape)
  .partial({ id: true })
  .refine(requireGenticGeneratedActionAuthor, {
    message: "Generated actions must be Gentic-authored",
    path: ["author_type"],
  })

export const unpublishedChangesSchema = recordUnpublishedChangesInputSchema
export const automaticPrPublishRequestSchema =
  requestAutomaticPrPublishInputSchema
export const realtimeTokenSchema = realtimeTokenInputSchema

export async function ensureActiveHostRun(
  supabase: Supabase,
  userId: string,
  hostId: string,
  issueId: string,
  runId: string
): Promise<void> {
  const issueResult = await supabase
    .from("issues")
    .select("id,active_host_id,active_run_id,projects!inner(user_id)")
    .eq("id", issueId)
    .maybeSingle()

  const { data: issue, error: issueError } = issueResult as {
    data: {
      id: string
      active_host_id: string | null
      active_run_id: string | null
      projects: { user_id: string }
    } | null
    error: { message: string } | null
  }

  if (issueError) {
    throw new Error(issueError.message)
  }
  if (!issue || issue.projects.user_id !== userId) {
    throw new ApiError(404, "Issue not found")
  }
  if (issue.active_host_id !== hostId || issue.active_run_id !== runId) {
    throw new ApiError(409, "Run is not active for this host")
  }

  // `last_seen_at` only drives the 90-second host display state.
  // The issue lease remains authoritative during the five-minute heartbeat
  // grace period; reconciliation clears it when the host is truly stale.
}

export async function ensureActiveReviewRunClaim(
  supabase: Supabase,
  userId: string,
  hostId: string,
  reviewRunId: string
): Promise<void> {
  const reviewRunResult = await supabase
    .from("review_runs")
    .select(
      "id,status,claimed_by_host_id,review_cycles!inner(issues!inner(projects!inner(user_id)))"
    )
    .eq("id", reviewRunId)
    .maybeSingle()

  const { data: reviewRun, error: reviewRunError } = reviewRunResult as {
    data: {
      id: string
      status: string
      claimed_by_host_id: string | null
      review_cycles: { issues: { projects: { user_id: string } } }
    } | null
    error: { message: string } | null
  }

  if (reviewRunError) {
    throw new Error(reviewRunError.message)
  }
  if (
    !reviewRun ||
    reviewRun.review_cycles.issues.projects.user_id !== userId
  ) {
    throw new ApiError(404, "Review run not found")
  }
  if (
    reviewRun.claimed_by_host_id !== hostId ||
    reviewRun.status !== "running"
  ) {
    throw new ApiError(409, "Review run is not claimed by this host")
  }
}

export async function getAgentContext(request: Request): Promise<{
  userId: string
  hostId: string
  banned: boolean
  supabase: Supabase
}> {
  return getAgentContextWithOptions(request)
}

export async function getAgentContextWithOptions(
  request: Request,
  options: {
    allowBanned?: boolean
  } = {}
): Promise<{
  userId: string
  hostId: string
  banned: boolean
  supabase: Supabase
}> {
  const supabase = createServiceClient()
  const { userId, hostId, banned } = await authenticateHostRequest(
    request,
    supabase,
    options
  )

  return {
    userId,
    hostId,
    banned,
    supabase,
  }
}

const SERVICE_ERROR_STATUS: Record<ServiceError["code"], number> = {
  not_found: 404,
  validation: 400,
  conflict: 409,
  rate_limited: 429,
  forbidden: 403,
  internal: 500,
}

export function handleAgentError(error: unknown): Response {
  if (error instanceof ApiError) {
    return json({ error: error.message }, { status: error.status })
  }
  if (error instanceof ServiceError) {
    if (error.code === "internal") {
      console.error("[agent-api] request failed:", error)
    }
    return json(
      { error: error.message },
      { status: SERVICE_ERROR_STATUS[error.code] }
    )
  }
  if (error instanceof z.ZodError) {
    return json({ error: "Invalid request" }, { status: 400 })
  }

  console.error("[agent-api] request failed:", error)
  return json({ error: "Internal server error" }, { status: 500 })
}

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init)
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

async function authenticateHostRequest(
  request: Request,
  supabase: Supabase,
  options: {
    allowBanned?: boolean
  } = {}
): Promise<{
  userId: string
  hostId: string
  banned: boolean
}> {
  const authorization = request.headers.get("authorization")
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]

  if (!token) {
    throw new ApiError(401, "Missing bearer token")
  }

  try {
    return await authenticateHostCredential(supabase, token, options)
  } catch (error) {
    if (error instanceof ServiceError && error.code === "forbidden") {
      throw new ApiError(401, "Invalid host credential")
    }
    throw error
  }
}
