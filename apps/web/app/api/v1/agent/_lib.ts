import { ServiceError } from "@gentic/services/errors"
import { ensureIssueOwned } from "@gentic/services/issues"
import { authenticateWorkerCredential } from "@gentic/services/workers"
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

// The statuses a worker run is allowed to move an issue into via `/run-state`.
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

export async function ensureActiveWorkerRun(
  supabase: Supabase,
  userId: string,
  workerId: string,
  issueId: string,
  runId: string
): Promise<void> {
  const issueResult = await supabase
    .from("issues")
    .select("id,active_worker_id,active_run_id,projects!inner(user_id)")
    .eq("id", issueId)
    .maybeSingle()

  const { data: issue, error: issueError } = issueResult as {
    data: {
      id: string
      active_worker_id: string | null
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
  if (issue.active_worker_id !== workerId || issue.active_run_id !== runId) {
    throw new ApiError(409, "Run is not active for this worker")
  }

  // `last_seen_at` only drives the 90-second connected-worker display state.
  // The issue lease remains authoritative during the five-minute heartbeat
  // grace period; reconciliation clears it when the worker is truly stale.
}

export async function getAgentContext(request: Request): Promise<{
  userId: string
  workerId: string
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
  workerId: string
  banned: boolean
  supabase: Supabase
}> {
  const supabase = createServiceClient()
  const { userId, workerId, banned } = await authenticateWorkerRequest(
    request,
    supabase,
    options
  )

  return {
    userId,
    workerId,
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

async function authenticateWorkerRequest(
  request: Request,
  supabase: Supabase,
  options: {
    allowBanned?: boolean
  } = {}
): Promise<{
  userId: string
  workerId: string
  banned: boolean
}> {
  const authorization = request.headers.get("authorization")
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]

  if (!token) {
    throw new ApiError(401, "Missing bearer token")
  }

  try {
    return await authenticateWorkerCredential(supabase, token, options)
  } catch (error) {
    if (error instanceof ServiceError && error.code === "forbidden") {
      throw new ApiError(401, "Invalid worker credential")
    }
    throw error
  }
}
