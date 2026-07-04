import { clerkClient } from "@clerk/nextjs/server"
import { createServiceClient } from "@gentic/supabase/service"
import { z } from "zod"

export type Supabase = ReturnType<typeof createServiceClient>

export const runStatusSchema = z.enum([
  "queued",
  "cloning",
  "running",
  "completed",
  "failed",
  "cancelled",
])

export const runStateSchema = z
  .object({
    run_status: runStatusSchema.optional(),
    session_id: z.string().nullable().optional(),
    run_error: z.string().nullable().optional(),
    run_started_at: z.string().datetime().nullable().optional(),
    run_finished_at: z.string().datetime().nullable().optional(),
    pr_url: z.string().url().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0)

export const insertMessageSchema = z.object({
  role: z.enum(["assistant", "system"]),
  kind: z.enum(["text", "tool", "thinking"]).optional(),
  content: z.string(),
  status: z.enum(["streaming", "complete", "error"]).optional(),
})

export const updateMessageSchema = z
  .object({
    content: z.string().optional(),
    status: z.enum(["streaming", "complete", "error"]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0)

const authCache = new Map<string, { userId: string; expiresAt: number }>()
const authCacheTtlMs = 60_000

export async function getAgentContext(request: Request): Promise<{
  userId: string
  supabase: Supabase
}> {
  return {
    userId: await authenticateApiKey(request),
    supabase: createServiceClient(),
  }
}

export async function ensureIssueOwned(
  supabase: Supabase,
  userId: string,
  issueId: string
): Promise<void> {
  const { data, error } = await supabase
    .from("issues")
    .select("id, projects!inner(user_id)")
    .eq("id", issueId)
    .eq("projects.user_id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }
  if (!data) {
    throw new ApiError(404, "Issue not found")
  }
}

export async function ensureMessageOwned(
  supabase: Supabase,
  userId: string,
  messageId: string
): Promise<void> {
  const { data, error } = await supabase
    .from("messages")
    .select("issue_id, role")
    .eq("id", messageId)
    .maybeSingle<{ issue_id: string; role: string }>()

  if (error) {
    throw new Error(error.message)
  }
  if (!data) {
    throw new ApiError(404, "Message not found")
  }
  if (data.role === "user") {
    throw new ApiError(403, "Cannot update user messages")
  }

  await ensureIssueOwned(supabase, userId, data.issue_id)
}

export function handleAgentError(error: unknown): Response {
  if (error instanceof ApiError) {
    return json({ error: error.message }, { status: error.status })
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

async function authenticateApiKey(request: Request): Promise<string> {
  const authorization = request.headers.get("authorization")
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]

  if (!token) {
    throw new ApiError(401, "Missing bearer token")
  }

  const cached = authCache.get(token)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.userId
  }

  try {
    const clerk = await clerkClient()
    const apiKey = await clerk.apiKeys.verify(token)
    const subject = apiKey.subject

    if (!subject.startsWith("user_")) {
      throw new ApiError(403, "API key must be user-scoped")
    }

    authCache.set(token, {
      userId: subject,
      expiresAt: Date.now() + authCacheTtlMs,
    })

    return subject
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }
    throw new ApiError(401, "Invalid API key")
  }
}
