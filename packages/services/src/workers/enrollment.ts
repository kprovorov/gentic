import { createHash, randomBytes } from "node:crypto"

import type { Json } from "@gentic/supabase/types"
import {
  consumeWorkerEnrollmentCodeInputSchema,
  workerCapacitySchema,
  workerCapabilitiesSchema,
  workerCredentialSchema,
  type ConsumeWorkerEnrollmentCodeInput,
} from "@gentic/validators/workers"

import { ServiceError } from "../errors"
import type { Supabase } from "../types"
import type { WorkerCompatibilityPolicy } from "./compatibility"
import { toWorkerDomain, type WorkerDomain } from "./domain"
import {
  parseOptionalPlatform,
  parseWorkerName,
  parseWorkerValue,
  type WorkerRow,
} from "./shared"

export const WORKER_ENROLLMENT_CODE_TTL_MS = 10 * 60 * 1000
export const WORKER_ENROLLMENT_MAX_FAILURES = 5
export const WORKER_ENROLLMENT_FAILURE_WINDOW_MS = 10 * 60 * 1000

const CODE_PREFIX = "gtce_"
const CREDENTIAL_PREFIX = "gtwc_"
const SECRET_BYTES = 32

export type WorkerEnrollmentCodeResult = {
  code: string
  expires_at: string
}

export type ExchangeWorkerEnrollmentCodeResult = {
  worker: WorkerDomain
  credential: string
}

export type WorkerCredentialContext = {
  userId: string
  workerId: string
  banned: boolean
}

export function hashWorkerSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex")
}

export async function createWorkerEnrollmentCode(
  supabase: Supabase,
  userId: string,
  options: {
    now?: Date
  } = {}
): Promise<WorkerEnrollmentCodeResult> {
  const now = options.now ?? new Date()
  const code = generateEnrollmentCode()
  const expiresAt = new Date(now.getTime() + WORKER_ENROLLMENT_CODE_TTL_MS)

  const { error: updateError } = await supabase
    .from("worker_enrollment_codes")
    .update({ consumed_at: now.toISOString() })
    .eq("user_id", userId)
    .is("consumed_at", null)

  if (updateError) {
    throw new ServiceError("internal", updateError.message)
  }

  const { error: insertError } = await supabase
    .from("worker_enrollment_codes")
    .insert({
      user_id: userId,
      code_hash: hashWorkerSecret(code),
      expires_at: expiresAt.toISOString(),
      created_at: now.toISOString(),
    })

  if (insertError) {
    throwWorkerEnrollmentWriteError(insertError)
  }

  return { code, expires_at: expiresAt.toISOString() }
}

export async function exchangeWorkerEnrollmentCode(
  supabase: Supabase,
  input: ConsumeWorkerEnrollmentCodeInput,
  options: {
    now?: Date
    rateLimitKey?: string
    compatibilityPolicy?: WorkerCompatibilityPolicy
  } = {}
): Promise<ExchangeWorkerEnrollmentCodeResult> {
  const fields = parseWorkerValue(
    () => consumeWorkerEnrollmentCodeInputSchema.parse(input),
    "Invalid enrollment code"
  )
  const now = options.now ?? new Date()
  const rateLimitKey = options.rateLimitKey
    ? hashWorkerSecret(options.rateLimitKey)
    : hashWorkerSecret(fields.code)

  await ensureEnrollmentExchangeAllowed(supabase, rateLimitKey, now)

  const credential = generateWorkerCredential()
  const credentialHash = hashWorkerSecret(credential)

  const rpcArgs = {
    p_code_hash: hashWorkerSecret(fields.code),
    p_credential_hash: credentialHash,
    p_display_name: parseWorkerName(fields.display_name),
    p_gentic_version: parseOptionalPlatform(fields.telemetry.gentic_version),
    p_os: parseOptionalPlatform(fields.telemetry.os),
    p_arch: parseOptionalPlatform(fields.telemetry.arch),
    p_configured_capacity: parseWorkerValue(() =>
      workerCapacitySchema.parse(fields.telemetry.configured_capacity)
    ),
    p_provider_capabilities: parseWorkerValue(() =>
      workerCapabilitiesSchema.parse(fields.telemetry.provider_capabilities)
    ) as Json,
    p_process_started_at: fields.telemetry.process_started_at,
    p_now: now.toISOString(),
  }

  const { data, error } = await supabase
    .rpc("consume_worker_enrollment_code", rpcArgs as never)
    .maybeSingle()
    .returns<WorkerRow | null>()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (!data) {
    await recordEnrollmentExchangeFailure(supabase, rateLimitKey, now)
    throw new ServiceError("validation", "Invalid enrollment code")
  }

  await clearEnrollmentExchangeFailures(supabase, rateLimitKey)

  return {
    credential,
    worker: toWorkerDomain(data, 0, {
      now,
      compatibilityPolicy: options.compatibilityPolicy,
    }),
  }
}

export async function authenticateWorkerCredential(
  supabase: Supabase,
  credential: string,
  options: {
    now?: Date
    allowBanned?: boolean
  } = {}
): Promise<WorkerCredentialContext> {
  const parsed = workerCredentialSchema.safeParse(credential)
  if (!parsed.success) {
    throw new ServiceError("forbidden", "Invalid worker credential")
  }

  const { data, error } = await supabase
    .from("workers")
    .select("id,user_id,banned_at,credential_expires_at")
    .eq("credential_hash", hashWorkerSecret(parsed.data))
    .maybeSingle()
    .returns<{
      id: string
      user_id: string
      banned_at: string | null
      credential_expires_at: string | null
    } | null>()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (!data) {
    throw new ServiceError("forbidden", "Invalid worker credential")
  }
  if (data.banned_at && !options.allowBanned) {
    throw new ServiceError("forbidden", "Invalid worker credential")
  }
  if (
    data.credential_expires_at &&
    new Date(data.credential_expires_at).getTime() <=
      (options.now ?? new Date()).getTime()
  ) {
    throw new ServiceError("forbidden", "Invalid worker credential")
  }

  return {
    userId: data.user_id,
    workerId: data.id,
    banned: Boolean(data.banned_at),
  }
}

function generateEnrollmentCode(): string {
  return `${CODE_PREFIX}${randomBytes(SECRET_BYTES).toString("base64url")}`
}

function generateWorkerCredential(): string {
  return `${CREDENTIAL_PREFIX}${randomBytes(SECRET_BYTES).toString("base64url")}`
}

async function ensureEnrollmentExchangeAllowed(
  supabase: Supabase,
  rateLimitKey: string,
  now: Date
): Promise<void> {
  const { data, error } = await supabase
    .from("worker_enrollment_exchange_failures")
    .select("failed_count,window_started_at,locked_until")
    .eq("rate_limit_key", rateLimitKey)
    .maybeSingle()
    .returns<{
      failed_count: number
      window_started_at: string
      locked_until: string | null
    } | null>()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (!data) {
    return
  }

  if (
    data.locked_until &&
    new Date(data.locked_until).getTime() > now.getTime()
  ) {
    throw new ServiceError("rate_limited", "Invalid enrollment code")
  }
}

async function recordEnrollmentExchangeFailure(
  supabase: Supabase,
  rateLimitKey: string,
  now: Date
): Promise<void> {
  const { error } = await supabase.rpc(
    "record_worker_enrollment_exchange_failure",
    {
      p_rate_limit_key: rateLimitKey,
      p_now: now.toISOString(),
      p_max_failures: WORKER_ENROLLMENT_MAX_FAILURES,
      p_window_ms: WORKER_ENROLLMENT_FAILURE_WINDOW_MS,
    } as never
  )

  if (error) {
    throw new ServiceError("internal", error.message)
  }
}

async function clearEnrollmentExchangeFailures(
  supabase: Supabase,
  rateLimitKey: string
): Promise<void> {
  const { error } = await supabase
    .from("worker_enrollment_exchange_failures")
    .delete()
    .eq("rate_limit_key", rateLimitKey)

  if (error) {
    throw new ServiceError("internal", error.message)
  }
}

function throwWorkerEnrollmentWriteError(error: {
  message: string
  code?: string
}): never {
  if (
    error.code === "23P01" ||
    error.message
      .toLowerCase()
      .includes("worker_enrollment_codes_one_active_per_user")
  ) {
    throw new ServiceError(
      "validation",
      "Worker enrollment code already exists"
    )
  }

  throw new ServiceError("internal", error.message)
}
