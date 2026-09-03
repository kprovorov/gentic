import { createHash, randomBytes } from "node:crypto"

import type { Json } from "@gentic/supabase/types"
import {
  consumeHostEnrollmentCodeInputSchema,
  hostCapacitySchema,
  hostCapabilitiesSchema,
  hostCredentialSchema,
  type ConsumeHostEnrollmentCodeInput,
} from "@gentic/validators/hosts"

import { ServiceError } from "../errors"
import type { Supabase } from "../types"
import type { HostCompatibilityPolicy } from "./compatibility"
import { toHostDomain, type HostDomain } from "./domain"
import {
  parseOptionalPlatform,
  parseHostName,
  parseHostValue,
  type HostRow,
} from "./shared"

export const HOST_ENROLLMENT_CODE_TTL_MS = 10 * 60 * 1000
export const HOST_ENROLLMENT_MAX_FAILURES = 5
export const HOST_ENROLLMENT_FAILURE_WINDOW_MS = 10 * 60 * 1000

const CODE_PREFIX = "gtce_"
// "gentic worker credential" — the one thing GEN-435 deliberately did not
// rename. Only the SHA-256 hash of a credential is stored, so the literal
// cannot be rewritten for credentials already in `hosts.credential_hash`;
// minting `gthc_` for new hosts would just split the format in two for a
// mnemonic nobody reads. It is an opaque token prefix, not vocabulary.
const CREDENTIAL_PREFIX = "gtwc_"
const SECRET_BYTES = 32

export type HostEnrollmentCodeResult = {
  code: string
  expires_at: string
}

export type ExchangeHostEnrollmentCodeResult = {
  host: HostDomain
  credential: string
}

export type HostCredentialContext = {
  userId: string
  hostId: string
  banned: boolean
}

export function hashHostSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex")
}

export async function createHostEnrollmentCode(
  supabase: Supabase,
  userId: string,
  options: {
    now?: Date
  } = {}
): Promise<HostEnrollmentCodeResult> {
  const now = options.now ?? new Date()
  const code = generateEnrollmentCode()
  const expiresAt = new Date(now.getTime() + HOST_ENROLLMENT_CODE_TTL_MS)

  const { error: updateError } = await supabase
    .from("host_enrollment_codes")
    .update({ consumed_at: now.toISOString() })
    .eq("user_id", userId)
    .is("consumed_at", null)

  if (updateError) {
    throw new ServiceError("internal", updateError.message)
  }

  const { error: insertError } = await supabase
    .from("host_enrollment_codes")
    .insert({
      user_id: userId,
      code_hash: hashHostSecret(code),
      expires_at: expiresAt.toISOString(),
      created_at: now.toISOString(),
    })

  if (insertError) {
    throwHostEnrollmentWriteError(insertError)
  }

  return { code, expires_at: expiresAt.toISOString() }
}

export async function exchangeHostEnrollmentCode(
  supabase: Supabase,
  input: ConsumeHostEnrollmentCodeInput,
  options: {
    now?: Date
    rateLimitKey?: string
    compatibilityPolicy?: HostCompatibilityPolicy
  } = {}
): Promise<ExchangeHostEnrollmentCodeResult> {
  const fields = parseHostValue(
    () => consumeHostEnrollmentCodeInputSchema.parse(input),
    "Invalid enrollment code"
  )
  const now = options.now ?? new Date()
  const rateLimitKey = options.rateLimitKey
    ? hashHostSecret(options.rateLimitKey)
    : hashHostSecret(fields.code)

  await ensureEnrollmentExchangeAllowed(supabase, rateLimitKey, now)

  const credential = generateHostCredential()
  const credentialHash = hashHostSecret(credential)

  const rpcArgs = {
    p_code_hash: hashHostSecret(fields.code),
    p_credential_hash: credentialHash,
    p_display_name: parseHostName(fields.display_name),
    p_gentic_version: parseOptionalPlatform(fields.telemetry.gentic_version),
    p_os: parseOptionalPlatform(fields.telemetry.os),
    p_arch: parseOptionalPlatform(fields.telemetry.arch),
    p_configured_capacity: parseHostValue(() =>
      hostCapacitySchema.parse(fields.telemetry.configured_capacity)
    ),
    p_provider_capabilities: parseHostValue(() =>
      hostCapabilitiesSchema.parse(fields.telemetry.provider_capabilities)
    ) as Json,
    p_process_started_at: fields.telemetry.process_started_at,
    p_now: now.toISOString(),
  }

  const { data, error } = await supabase
    .rpc("consume_host_enrollment_code", rpcArgs as never)
    .maybeSingle()
    .returns<HostRow | null>()

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
    host: toHostDomain(data, 0, {
      now,
      compatibilityPolicy: options.compatibilityPolicy,
    }),
  }
}

export async function authenticateHostCredential(
  supabase: Supabase,
  credential: string,
  options: {
    now?: Date
    allowBanned?: boolean
  } = {}
): Promise<HostCredentialContext> {
  const parsed = hostCredentialSchema.safeParse(credential)
  if (!parsed.success) {
    throw new ServiceError("forbidden", "Invalid host credential")
  }

  const { data, error } = await supabase
    .from("hosts")
    .select("id,user_id,banned_at,credential_expires_at")
    .eq("credential_hash", hashHostSecret(parsed.data))
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
    throw new ServiceError("forbidden", "Invalid host credential")
  }
  if (data.banned_at && !options.allowBanned) {
    throw new ServiceError("forbidden", "Invalid host credential")
  }
  if (
    data.credential_expires_at &&
    new Date(data.credential_expires_at).getTime() <=
      (options.now ?? new Date()).getTime()
  ) {
    throw new ServiceError("forbidden", "Invalid host credential")
  }

  return {
    userId: data.user_id,
    hostId: data.id,
    banned: Boolean(data.banned_at),
  }
}

function generateEnrollmentCode(): string {
  return `${CODE_PREFIX}${randomBytes(SECRET_BYTES).toString("base64url")}`
}

function generateHostCredential(): string {
  return `${CREDENTIAL_PREFIX}${randomBytes(SECRET_BYTES).toString("base64url")}`
}

async function ensureEnrollmentExchangeAllowed(
  supabase: Supabase,
  rateLimitKey: string,
  now: Date
): Promise<void> {
  const { data, error } = await supabase
    .from("host_enrollment_exchange_failures")
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
    "record_host_enrollment_exchange_failure",
    {
      p_rate_limit_key: rateLimitKey,
      p_now: now.toISOString(),
      p_max_failures: HOST_ENROLLMENT_MAX_FAILURES,
      p_window_ms: HOST_ENROLLMENT_FAILURE_WINDOW_MS,
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
    .from("host_enrollment_exchange_failures")
    .delete()
    .eq("rate_limit_key", rateLimitKey)

  if (error) {
    throw new ServiceError("internal", error.message)
  }
}

function throwHostEnrollmentWriteError(error: {
  message: string
  code?: string
}): never {
  if (
    error.code === "23P01" ||
    error.message
      .toLowerCase()
      .includes("host_enrollment_codes_one_active_per_user")
  ) {
    throw new ServiceError(
      "validation",
      "Host enrollment code already exists"
    )
  }

  throw new ServiceError("internal", error.message)
}
