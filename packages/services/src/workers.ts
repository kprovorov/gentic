import type { Json, Tables, Updates } from "@gentic/supabase/types"
import {
  workerCapacitySchema,
  workerCapabilitiesSchema,
  workerDisplayNameSchema,
  workerHashSchema,
  workerNormalizedNameSchema,
  workerPlatformSchema,
  workerSetupStateSchema,
  type WorkerCapabilities,
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
