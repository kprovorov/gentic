import type { Json, Updates } from "@gentic/supabase/types"
import {
  workerCapacitySchema,
  workerCapabilitiesSchema,
  workerHashSchema,
  workerSetupStateSchema,
  type WorkerCapabilities,
  type WorkerHeartbeatTelemetry,
  type WorkerSetupState,
} from "@gentic/validators/workers"

import { ServiceError } from "../errors"
import type { Supabase } from "../types"
import {
  sanitizeProviderCapabilities,
  toWorkerDomain,
  type WorkerDomain,
  type WorkerProjectionOptions,
} from "./domain"
import {
  ensureWorkerNameAvailable,
  listRunningTaskCounts,
  parseOptionalPlatform,
  parseWorkerName,
  parseWorkerValue,
  workerSelect,
  type WorkerRow,
} from "./shared"

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
  offline_since_at?: string | null
  process_started_at?: string | null
  gentic_version?: string | null
  os?: string | null
  arch?: string | null
  configured_capacity?: number
  provider_capabilities?: WorkerCapabilities
}

export type RenameWorkerInput = {
  display_name: string
}

export async function createWorker(
  supabase: Supabase,
  userId: string,
  input: CreateWorkerInput,
  options: WorkerProjectionOptions = {}
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
        ? parseWorkerValue(() =>
            workerSetupStateSchema.parse(input.setup_state)
          )
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
      provider_capabilities: (input.provider_capabilities
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
  options: WorkerProjectionOptions & {
    requireUnbanned?: boolean
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
  if (input.offline_since_at !== undefined) {
    values.offline_since_at = input.offline_since_at
  }
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

  let query = supabase
    .from("workers")
    .update(values)
    .eq("id", id)
    .eq("user_id", userId)

  if (options.requireUnbanned) {
    query = query.is("banned_at", null)
  }

  const { data, error } = await query
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

export async function recordWorkerHeartbeat(
  supabase: Supabase,
  userId: string,
  workerId: string,
  telemetry: WorkerHeartbeatTelemetry,
  options: WorkerProjectionOptions = {}
): Promise<WorkerDomain> {
  return updateWorker(
    supabase,
    userId,
    workerId,
    {
      last_seen_at:
        telemetry.last_seen_at ?? (options.now ?? new Date()).toISOString(),
      offline_since_at: null,
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
    { ...options, requireUnbanned: true }
  )
}

export async function markWorkerOffline(
  supabase: Supabase,
  userId: string,
  workerId: string,
  options: WorkerProjectionOptions = {}
): Promise<WorkerDomain> {
  return updateWorker(
    supabase,
    userId,
    workerId,
    {
      last_seen_at: null,
      offline_since_at: (options.now ?? new Date()).toISOString(),
    },
    { ...options, requireUnbanned: true }
  )
}

export async function renameWorker(
  supabase: Supabase,
  userId: string,
  workerId: string,
  input: RenameWorkerInput,
  options: WorkerProjectionOptions = {}
): Promise<WorkerDomain> {
  const displayName = parseWorkerName(input.display_name)
  const { data, error } = await supabase
    .rpc("rename_worker", {
      p_user_id: userId,
      p_worker_id: workerId,
      p_display_name: displayName,
      p_now: (options.now ?? new Date()).toISOString(),
    })
    .maybeSingle()
    .returns<WorkerRow | null>()

  const row = unwrapWorkerLifecycleRpc(data, error)
  const counts = await listRunningTaskCounts(supabase, [workerId])
  return toWorkerDomain(row, counts.get(workerId) ?? 0, options)
}

export async function banWorker(
  supabase: Supabase,
  userId: string,
  workerId: string,
  options: WorkerProjectionOptions = {}
): Promise<WorkerDomain> {
  return runWorkerLifecycleRpc(
    supabase,
    "ban_worker",
    userId,
    workerId,
    options
  )
}

export async function unbanWorker(
  supabase: Supabase,
  userId: string,
  workerId: string,
  options: WorkerProjectionOptions = {}
): Promise<WorkerDomain> {
  return runWorkerLifecycleRpc(
    supabase,
    "unban_worker",
    userId,
    workerId,
    options
  )
}

export async function deleteWorker(
  supabase: Supabase,
  userId: string,
  workerId: string,
  options: {
    now?: Date
  } = {}
): Promise<void> {
  const { data, error } = await supabase
    .rpc("delete_worker", {
      p_user_id: userId,
      p_worker_id: workerId,
      p_now: (options.now ?? new Date()).toISOString(),
    })
    .single<boolean>()

  if (error) {
    throwWorkerLifecycleRpcError(error)
  }
  if (!data) {
    throw new ServiceError("not_found", "Worker not found")
  }
}

async function runWorkerLifecycleRpc(
  supabase: Supabase,
  name: "ban_worker" | "unban_worker",
  userId: string,
  workerId: string,
  options: WorkerProjectionOptions
): Promise<WorkerDomain> {
  const { data, error } = await supabase
    .rpc(name, {
      p_user_id: userId,
      p_worker_id: workerId,
      p_now: (options.now ?? new Date()).toISOString(),
    })
    .maybeSingle()
    .returns<WorkerRow | null>()

  const row = unwrapWorkerLifecycleRpc(data, error)
  const counts = await listRunningTaskCounts(supabase, [workerId])
  return toWorkerDomain(row, counts.get(workerId) ?? 0, options)
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

function unwrapWorkerLifecycleRpc(
  data: WorkerRow | null,
  error: null | { message: string; code?: string }
): WorkerRow {
  if (error) {
    throwWorkerLifecycleRpcError(error)
  }
  if (!data) {
    throw new ServiceError("not_found", "Worker not found")
  }
  return data
}

function throwWorkerLifecycleRpcError(error: {
  message: string
  code?: string
}): never {
  if (
    error.code === "23505" ||
    error.message.toLowerCase().includes("worker name is already in use") ||
    error.message.toLowerCase().includes("workers_user_normalized_name_unique")
  ) {
    throw new ServiceError("validation", "Worker name is already in use")
  }
  if (
    error.code === "22023" ||
    error.message.toLowerCase().includes("worker name must be between")
  ) {
    throw new ServiceError(
      "validation",
      "Worker name must be between 1 and 80 characters"
    )
  }

  throw new ServiceError("internal", error.message)
}

function throwWorkerWriteError(error: {
  message: string
  code?: string
}): never {
  if (
    error.code === "23505" ||
    error.message.toLowerCase().includes("workers_user_normalized_name_unique")
  ) {
    throw new ServiceError("validation", "Worker name is already in use")
  }

  throw new ServiceError("internal", error.message)
}
