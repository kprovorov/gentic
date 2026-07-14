import { createHash } from "node:crypto"

import { clerkClient } from "@clerk/nextjs/server"
import { ServiceError } from "@gentic/services/errors"
import { ensureIssueOwned } from "@gentic/services/issues"
import { createServiceClient } from "@gentic/supabase/service"
import { issueStatusSchema } from "@gentic/validators/issues"
import { z } from "zod"

import { getRedis } from "@/lib/redis"

export { ensureIssueOwned }

export type Supabase = ReturnType<typeof createServiceClient>

// The statuses a worker run is allowed to move an issue into via `/run-state`.
// Everything else (e.g. `merged`, `approved`) is set by the user or the
// GitHub webhook, not the agent run itself.
export const runStateStatusSchema = issueStatusSchema.extract([
  "in-progress",
  "held",
  "run-failed",
  "ready-for-review",
  "waiting-for-input",
])

export const runStateSchema = z
  .object({
    run_id: z.string().uuid(),
    status: runStateStatusSchema.optional(),
    session_id: z.string().nullable().optional(),
    run_error: z.string().nullable().optional(),
    run_started_at: z.string().datetime().nullable().optional(),
    run_finished_at: z.string().datetime().nullable().optional(),
    usage_limit_reset_at: z.string().datetime().nullable().optional(),
    pr_url: z.string().url().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0)

export const insertMessageSchema = z.object({
  run_id: z.string().uuid(),
  id: z.string().uuid().optional(),
  role: z.enum(["assistant", "system"]),
  kind: z.enum(["text", "tool", "thinking"]).optional(),
  content: z.string(),
  status: z.enum(["complete", "error"]).optional(),
})

// Two-tier cache over the Clerk API-key -> user id lookup. Every verify against
// Clerk bills one API-key usage and the worker polls constantly, so caching is
// what keeps that from running away (~24 verifications/day per token instead of
// one per request). L1 is per-instance memory; L2 is Upstash Redis, shared
// across all serverless instances so a cold or parallel invocation still avoids
// Clerk. A revoked key keeps working until its entries expire (≤ the Redis TTL).
const REDIS_TTL_SECONDS = 60 * 60
const LOCAL_TTL_MS = 60_000
const localAuthCache = new Map<string, { userId: string; expiresAt: number }>()

function authCacheKey(token: string): string {
  // Hash so the raw secret key is never stored in Redis.
  return `agent:apikey:${createHash("sha256").update(token).digest("hex")}`
}

export async function getAgentContext(request: Request): Promise<{
  userId: string
  supabase: Supabase
}> {
  return {
    userId: await authenticateApiKey(request),
    supabase: createServiceClient(),
  }
}

const SERVICE_ERROR_STATUS: Record<ServiceError["code"], number> = {
  not_found: 404,
  validation: 400,
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

// TEMPORARY: special API key for testing. Bypasses Clerk verification entirely
// and authenticates as a fixed user. Only active when both env vars are set, so
// it stays disabled anywhere they aren't configured. Remove before shipping.
const SPECIAL_TEST_API_KEY = process.env.SPECIAL_TEST_API_KEY
const SPECIAL_TEST_USER_ID = process.env.SPECIAL_TEST_USER_ID

async function authenticateApiKey(request: Request): Promise<string> {
  const authorization = request.headers.get("authorization")
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]

  if (!token) {
    throw new ApiError(401, "Missing bearer token")
  }

  // TEMPORARY testing bypass — see note above.
  if (
    SPECIAL_TEST_API_KEY &&
    SPECIAL_TEST_USER_ID &&
    token === SPECIAL_TEST_API_KEY
  ) {
    return SPECIAL_TEST_USER_ID
  }

  const key = authCacheKey(token)

  const local = localAuthCache.get(key)
  if (local && local.expiresAt > Date.now()) {
    return local.userId
  }

  const redis = getRedis()
  const cachedUserId = await redisGet(redis, key)
  if (cachedUserId) {
    rememberLocally(key, cachedUserId)
    return cachedUserId
  }

  const subject = await verifyApiKeyWithClerk(token)
  rememberLocally(key, subject)
  await redisSet(redis, key, subject)
  return subject
}

async function verifyApiKeyWithClerk(token: string): Promise<string> {
  try {
    const clerk = await clerkClient()
    const apiKey = await clerk.apiKeys.verify(token)
    const subject = apiKey.subject

    if (!subject.startsWith("user_")) {
      throw new ApiError(403, "API key must be user-scoped")
    }
    return subject
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }
    throw new ApiError(401, "Invalid API key")
  }
}

function rememberLocally(key: string, userId: string): void {
  localAuthCache.set(key, { userId, expiresAt: Date.now() + LOCAL_TTL_MS })
}

// Redis is a best-effort shared cache: when it's unconfigured or unreachable we
// fall back to verifying against Clerk rather than failing the request.
type RedisClient = ReturnType<typeof getRedis>

async function redisGet(
  redis: RedisClient,
  key: string
): Promise<string | null> {
  if (!redis) {
    return null
  }
  try {
    return await redis.get<string>(key)
  } catch (error) {
    console.error("[agent-api] auth cache read failed:", error)
    return null
  }
}

async function redisSet(
  redis: RedisClient,
  key: string,
  userId: string
): Promise<void> {
  if (!redis) {
    return
  }
  try {
    await redis.set(key, userId, { ex: REDIS_TTL_SECONDS })
  } catch (error) {
    console.error("[agent-api] auth cache write failed:", error)
  }
}
