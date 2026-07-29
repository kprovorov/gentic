import { createHash, randomBytes } from "node:crypto"

import type { Json, Tables, Updates } from "@gentic/supabase/types"
import {
  consumeWorkerEnrollmentCodeInputSchema,
  workerCapacitySchema,
  workerCapabilitiesSchema,
  workerDisplayNameSchema,
  workerHashSchema,
  workerNormalizedNameSchema,
  workerPlatformSchema,
  workerCredentialSchema,
  workerSetupStateSchema,
  type ConsumeWorkerEnrollmentCodeInput,
  type WorkerCapabilities,
  type WorkerHeartbeatTelemetry,
  type WorkerSetupState,
} from "@gentic/validators/workers"

import { ServiceError, unwrap } from "./errors"
import type { Supabase } from "./types"
import {
  classifyWorkerVersion,
  type WorkerCompatibilityPolicy,
  type WorkerVersionHealth,
} from "./workers/compatibility"

export {
  classifyWorkerVersion,
  defaultWorkerCompatibilityPolicy,
  type WorkerCompatibilityPolicy,
  type WorkerVersionHealth,
} from "./workers/compatibility"

export const WORKER_OFFLINE_AFTER_MS = 90_000
export const WORKER_ENROLLMENT_CODE_TTL_MS = 10 * 60 * 1000
export const WORKER_ENROLLMENT_MAX_FAILURES = 5
export const WORKER_ENROLLMENT_FAILURE_WINDOW_MS = 10 * 60 * 1000

const CODE_PREFIX = "gtce_"
const CREDENTIAL_PREFIX = "gtwc_"
const SECRET_BYTES = 32

export type WorkerPrimaryState =
  | "setup-incomplete"
  | "online"
  | "offline"
  | "banned"

export type WorkerProviderReadiness = {
  installed: boolean
  authenticated: boolean | null
  version: string | null
}

type WorkerProviderKey = keyof WorkerCapabilities["providers"]

export type WorkerDomain = Pick<
  Tables<"workers">,
  | "id"
  | "display_name"
  | "setup_state"
  | "banned_at"
  | "created_at"
  | "updated_at"
  | "last_seen_at"
  | "process_started_at"
  | "gentic_version"
  | "os"
  | "arch"
  | "configured_capacity"
> & {
  primary_state: WorkerPrimaryState
  version_health: WorkerVersionHealth
  providers: Record<WorkerProviderKey, WorkerProviderReadiness | null>
  running_task_count: number
}

export type CreateWorkerInput = {
  display_name: string
  credential_hash: string
  setup_state?: WorkerSetupState
  banned_at?: string | null
  last_seen_at?: string | null
  process_started_at?: string | null
  gentic_version?: string | null
  os?: string | null
  arch?: string | null
  configured_capacity?: number
  provider_capabilities?: WorkerCapabilities
}

export type UpdateWorkerInput = {
  display_name?: string
  credential_hash?: string
  setup_state?: WorkerSetupState
  banned_at?: string | null
  last_seen_at?: string | null
  process_started_at?: string | null
  gentic_version?: string | null
  os?: string | null
  arch?: string | null
  configured_capacity?: number
  provider_capabilities?: WorkerCapabilities
}

type WorkerRow = Tables<"workers">
const workerSelect =
  "id,user_id,display_name,setup_state,banned_at,created_at,updated_at,last_seen_at,process_started_at,gentic_version,os,arch,configured_capacity,provider_capabilities"

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

export type WorkerControlState = {
  worker: {
    banned: boolean
  }
  runs: Array<{
    issue_id: string
    active_run_id: string | null
    status: string
  }>
}

export async function listWorkers(
  supabase: Supabase,
  userId: string,
  options: {
    now?: Date
    compatibilityPolicy?: WorkerCompatibilityPolicy
  } = {}
): Promise<WorkerDomain[]> {
  const rows = unwrap(
    await supabase
      .from("workers")
      .select(workerSelect)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .returns<WorkerRow[]>()
  )

  const counts = await listRunningTaskCounts(
    supabase,
    rows.map((row) => row.id)
  )

  return rows.map((row) =>
    toWorkerDomain(row, counts.get(row.id) ?? 0, options)
  )
}

export async function getWorker(
  supabase: Supabase,
  userId: string,
  id: string,
  options: {
    now?: Date
    compatibilityPolicy?: WorkerCompatibilityPolicy
  } = {}
): Promise<WorkerDomain> {
  const { data, error } = await supabase
    .from("workers")
    .select(workerSelect)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle()
    .returns<WorkerRow | null>()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (!data) {
    throw new ServiceError("not_found", "Worker not found")
  }

  const counts = await listRunningTaskCounts(supabase, [id])
  return toWorkerDomain(data, counts.get(id) ?? 0, options)
}

export async function createWorker(
  supabase: Supabase,
  userId: string,
  input: CreateWorkerInput,
  options: {
    now?: Date
    compatibilityPolicy?: WorkerCompatibilityPolicy
  } = {}
): Promise<WorkerDomain> {
  const displayName = parseWorkerName(input.display_name)
  await ensureWorkerNameAvailable(supabase, userId, displayName)

  const result = await supabase
    .from("workers")
    .insert({
      user_id: userId,
      display_name: displayName,
      credential_hash: parseWorkerValue(
        () => workerHashSchema.parse(input.credential_hash),
        "Worker credential hash is invalid"
      ),
      setup_state: input.setup_state
        ? parseWorkerValue(() => workerSetupStateSchema.parse(input.setup_state))
        : "enrolling",
      banned_at: input.banned_at ?? null,
      last_seen_at: input.last_seen_at ?? null,
      process_started_at: input.process_started_at ?? null,
      gentic_version: parseOptionalPlatform(input.gentic_version),
      os: parseOptionalPlatform(input.os),
      arch: parseOptionalPlatform(input.arch),
      configured_capacity:
        input.configured_capacity === undefined
          ? 1
          : parseWorkerValue(() =>
              workerCapacitySchema.parse(input.configured_capacity)
            ),
      provider_capabilities:
        (input.provider_capabilities
          ? parseWorkerValue(() =>
              workerCapabilitiesSchema.parse(input.provider_capabilities)
            )
          : { providers: {} }) as Json,
    })
    .select(workerSelect)
    .single()
    .returns<WorkerRow>()

  const row = unwrapWorkerWrite(result)
  return toWorkerDomain(row, 0, options)
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
    .returns<
      | {
          id: string
          user_id: string
          banned_at: string | null
          credential_expires_at: string | null
        }
      | null
    >()

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

  return { userId: data.user_id, workerId: data.id, banned: Boolean(data.banned_at) }
}

export async function recordWorkerHeartbeat(
  supabase: Supabase,
  userId: string,
  workerId: string,
  telemetry: WorkerHeartbeatTelemetry,
  options: {
    now?: Date
    compatibilityPolicy?: WorkerCompatibilityPolicy
  } = {}
): Promise<WorkerDomain> {
  return updateWorker(
    supabase,
    userId,
    workerId,
    {
      last_seen_at: telemetry.last_seen_at ?? (options.now ?? new Date()).toISOString(),
      process_started_at: telemetry.process_started_at,
      gentic_version: telemetry.gentic_version,
      os: telemetry.os,
      arch: telemetry.arch,
      configured_capacity: telemetry.configured_capacity,
      setup_state: telemetry.setup_completed ? "ready" : "enrolling",
      provider_capabilities: sanitizeProviderCapabilities(
        telemetry.provider_capabilities
      ),
    },
    options
  )
}

export async function markWorkerOffline(
  supabase: Supabase,
  userId: string,
  workerId: string,
  options: {
    now?: Date
    compatibilityPolicy?: WorkerCompatibilityPolicy
  } = {}
): Promise<WorkerDomain> {
  return updateWorker(
    supabase,
    userId,
    workerId,
    {
      last_seen_at: null,
    },
    options
  )
}

export async function getWorkerControlState(
  supabase: Supabase,
  workerId: string,
  banned: boolean
): Promise<WorkerControlState> {
  const rows = unwrap(
    await supabase
      .from("issues")
      .select("id,active_run_id,status")
      .eq("active_worker_id", workerId)
      .not("status", "in", "(completed,cancelled)")
      .returns<
        Array<{
          id: string
          active_run_id: string | null
          status: string
        }>
      >()
  )

  return {
    worker: { banned },
    runs: rows.map((row) => ({
      issue_id: row.id,
      active_run_id: row.active_run_id,
      status: row.status,
    })),
  }
}

export async function updateWorker(
  supabase: Supabase,
  userId: string,
  id: string,
  input: UpdateWorkerInput,
  options: {
    now?: Date
    compatibilityPolicy?: WorkerCompatibilityPolicy
  } = {}
): Promise<WorkerDomain> {
  if (Object.keys(input).length === 0) {
    throw new ServiceError("validation", "Worker update cannot be empty")
  }

  const values: Updates<"workers"> = {
    updated_at: new Date().toISOString(),
  }

  if (input.display_name !== undefined) {
    const displayName = parseWorkerName(input.display_name)
    await ensureWorkerNameAvailable(supabase, userId, displayName, id)
    values.display_name = displayName
  }
  if (input.credential_hash !== undefined) {
    values.credential_hash = parseWorkerValue(
      () => workerHashSchema.parse(input.credential_hash),
      "Worker credential hash is invalid"
    )
  }
  if (input.setup_state !== undefined) {
    values.setup_state = parseWorkerValue(() =>
      workerSetupStateSchema.parse(input.setup_state)
    )
  }
  if (input.banned_at !== undefined) values.banned_at = input.banned_at
  if (input.last_seen_at !== undefined) values.last_seen_at = input.last_seen_at
  if (input.process_started_at !== undefined) {
    values.process_started_at = input.process_started_at
  }
  if (input.gentic_version !== undefined) {
    values.gentic_version = parseOptionalPlatform(input.gentic_version)
  }
  if (input.os !== undefined) values.os = parseOptionalPlatform(input.os)
  if (input.arch !== undefined) values.arch = parseOptionalPlatform(input.arch)
  if (input.configured_capacity !== undefined) {
    values.configured_capacity = parseWorkerValue(() =>
      workerCapacitySchema.parse(input.configured_capacity)
    )
  }
  if (input.provider_capabilities !== undefined) {
    values.provider_capabilities = parseWorkerValue(() =>
      workerCapabilitiesSchema.parse(input.provider_capabilities)
    ) as Json
  }

  const { data, error } = await supabase
    .from("workers")
    .update(values)
    .eq("id", id)
    .eq("user_id", userId)
    .select(workerSelect)
    .maybeSingle()
    .returns<WorkerRow | null>()

  if (error) {
    throwWorkerWriteError(error)
  }
  if (!data) {
    throw new ServiceError("not_found", "Worker not found")
  }

  const counts = await listRunningTaskCounts(supabase, [id])
  return toWorkerDomain(data, counts.get(id) ?? 0, options)
}

function parseWorkerName(name: string): string {
  return parseWorkerValue(
    () => workerDisplayNameSchema.parse(name),
    "Worker name must be between 1 and 80 characters"
  )
}

export function hashWorkerSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex")
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

function parseOptionalPlatform(value: string | null | undefined): string | null {
  return value === null || value === undefined
    ? null
    : parseWorkerValue(() => workerPlatformSchema.parse(value))
}

function parseWorkerValue<T>(
  parse: () => T,
  message = "Worker input is invalid"
): T {
  try {
    return parse()
  } catch {
    throw new ServiceError("validation", message)
  }
}

async function ensureWorkerNameAvailable(
  supabase: Supabase,
  userId: string,
  displayName: string,
  exceptWorkerId?: string
): Promise<void> {
  let query = supabase
    .from("workers")
    .select("id")
    .eq("user_id", userId)
    .eq("normalized_name", workerNormalizedNameSchema.parse(displayName))

  if (exceptWorkerId) {
    query = query.neq("id", exceptWorkerId)
  }

  const { data, error } = await query.maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (data) {
    throw new ServiceError("validation", "Worker name is already in use")
  }
}

async function listRunningTaskCounts(
  supabase: Supabase,
  workerIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()

  if (workerIds.length === 0) {
    return counts
  }

  const rows = unwrap(
    await supabase
      .from("issues")
      .select("active_worker_id")
      .in("active_worker_id", workerIds)
      .not("active_worker_id", "is", null)
      .not("status", "in", "(completed,cancelled)")
      .returns<Array<{ active_worker_id: string | null }>>()
  )

  for (const row of rows) {
    if (row.active_worker_id) {
      counts.set(
        row.active_worker_id,
        (counts.get(row.active_worker_id) ?? 0) + 1
      )
    }
  }

  return counts
}

function toWorkerDomain(
  row: WorkerRow,
  runningTaskCount: number,
  options: {
    now?: Date
    compatibilityPolicy?: WorkerCompatibilityPolicy
  }
): WorkerDomain {
  const capabilities = parseCapabilities(row.provider_capabilities)

  return {
    id: row.id,
    display_name: row.display_name,
    setup_state: row.setup_state,
    banned_at: row.banned_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_seen_at: row.last_seen_at,
    process_started_at: row.process_started_at,
    gentic_version: row.gentic_version,
    os: row.os,
    arch: row.arch,
    configured_capacity: row.configured_capacity,
    primary_state: deriveWorkerPrimaryState(row, options.now ?? new Date()),
    version_health: classifyWorkerVersion(
      row.gentic_version,
      options.compatibilityPolicy
    ),
    providers: {
      claude_code: toProviderReadiness(capabilities.providers.claude_code),
      codex: toProviderReadiness(capabilities.providers.codex),
    },
    running_task_count: runningTaskCount,
  }
}

function deriveWorkerPrimaryState(row: WorkerRow, now: Date): WorkerPrimaryState {
  if (row.banned_at) {
    return "banned"
  }
  if (row.setup_state !== "ready") {
    return "setup-incomplete"
  }
  if (!row.last_seen_at) {
    return "offline"
  }

  return now.getTime() - new Date(row.last_seen_at).getTime() <=
    WORKER_OFFLINE_AFTER_MS
    ? "online"
    : "offline"
}

function parseCapabilities(value: Json): WorkerCapabilities {
  const result = workerCapabilitiesSchema.safeParse(value)
  return result.success ? result.data : { providers: {} }
}

function sanitizeProviderCapabilities(
  capabilities: WorkerCapabilities
): WorkerCapabilities {
  const sanitized: WorkerCapabilities = { providers: {} }
  for (const key of ["claude_code", "codex"] as const) {
    const capability = capabilities.providers[key]
    if (!capability) continue
    sanitized.providers[key] = {
      enabled: capability.enabled,
      available: capability.available,
      authenticated: capability.authenticated,
      version: capability.version,
      models: [],
      metadata: {},
    }
  }
  return sanitized
}

function toProviderReadiness(
  capability: WorkerCapabilities["providers"][WorkerProviderKey]
): WorkerProviderReadiness | null {
  if (!capability) {
    return null
  }

  return {
    installed: capability.available,
    authenticated: capability.authenticated,
    version: capability.version,
  }
}

function unwrapWorkerWrite(result: {
  data: WorkerRow | null
  error: null | { message: string; code?: string }
}): WorkerRow {
  if (result.error) {
    throwWorkerWriteError(result.error)
  }
  if (!result.data) {
    throw new ServiceError("internal", "Worker write returned no row")
  }
  return result.data
}

function throwWorkerWriteError(error: { message: string; code?: string }): never {
  if (
    error.code === "23505" ||
    error.message.toLowerCase().includes("workers_user_normalized_name_unique")
  ) {
    throw new ServiceError("validation", "Worker name is already in use")
  }

  throw new ServiceError("internal", error.message)
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
    throw new ServiceError("validation", "Worker enrollment code already exists")
  }

  throw new ServiceError("internal", error.message)
}
