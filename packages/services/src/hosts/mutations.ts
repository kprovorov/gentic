import type { Json, Updates } from "@gentic/supabase/types"
import {
  hostCapacitySchema,
  hostCapabilitiesSchema,
  hostHashSchema,
  hostSetupStateSchema,
  type HostCapabilities,
  type HostHeartbeatTelemetry,
  type HostSetupState,
} from "@gentic/validators/hosts"

import { ServiceError } from "../errors"
import type { Supabase } from "../types"
import {
  sanitizeProviderCapabilities,
  toHostDomain,
  type HostDomain,
  type HostProjectionOptions,
} from "./domain"
import {
  ensureHostNameAvailable,
  listRunningTaskCounts,
  parseOptionalPlatform,
  parseHostName,
  parseHostValue,
  hostSelect,
  type HostRow,
} from "./shared"

export type CreateHostInput = {
  display_name: string
  credential_hash: string
  setup_state?: HostSetupState
  banned_at?: string | null
  last_seen_at?: string | null
  process_started_at?: string | null
  gentic_version?: string | null
  os?: string | null
  arch?: string | null
  configured_capacity?: number
  provider_capabilities?: HostCapabilities
}

export type UpdateHostInput = {
  display_name?: string
  credential_hash?: string
  setup_state?: HostSetupState
  banned_at?: string | null
  last_seen_at?: string | null
  offline_since_at?: string | null
  process_started_at?: string | null
  gentic_version?: string | null
  os?: string | null
  arch?: string | null
  configured_capacity?: number
  provider_capabilities?: HostCapabilities
}

export type RenameHostInput = {
  display_name: string
}

export async function createHost(
  supabase: Supabase,
  userId: string,
  input: CreateHostInput,
  options: HostProjectionOptions = {}
): Promise<HostDomain> {
  const displayName = parseHostName(input.display_name)
  await ensureHostNameAvailable(supabase, userId, displayName)

  const result = await supabase
    .from("hosts")
    .insert({
      user_id: userId,
      display_name: displayName,
      credential_hash: parseHostValue(
        () => hostHashSchema.parse(input.credential_hash),
        "Host credential hash is invalid"
      ),
      setup_state: input.setup_state
        ? parseHostValue(() =>
            hostSetupStateSchema.parse(input.setup_state)
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
          : parseHostValue(() =>
              hostCapacitySchema.parse(input.configured_capacity)
            ),
      provider_capabilities: (input.provider_capabilities
        ? parseHostValue(() =>
            hostCapabilitiesSchema.parse(input.provider_capabilities)
          )
        : { providers: {} }) as Json,
    })
    .select(hostSelect)
    .single()
    .returns<HostRow>()

  const row = unwrapHostWrite(result)
  return toHostDomain(row, 0, options)
}

export async function updateHost(
  supabase: Supabase,
  userId: string,
  id: string,
  input: UpdateHostInput,
  options: HostProjectionOptions & {
    requireUnbanned?: boolean
  } = {}
): Promise<HostDomain> {
  if (Object.keys(input).length === 0) {
    throw new ServiceError("validation", "Host update cannot be empty")
  }

  const values: Updates<"hosts"> = {
    updated_at: new Date().toISOString(),
  }

  if (input.display_name !== undefined) {
    const displayName = parseHostName(input.display_name)
    await ensureHostNameAvailable(supabase, userId, displayName, id)
    values.display_name = displayName
  }
  if (input.credential_hash !== undefined) {
    values.credential_hash = parseHostValue(
      () => hostHashSchema.parse(input.credential_hash),
      "Host credential hash is invalid"
    )
  }
  if (input.setup_state !== undefined) {
    values.setup_state = parseHostValue(() =>
      hostSetupStateSchema.parse(input.setup_state)
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
    values.configured_capacity = parseHostValue(() =>
      hostCapacitySchema.parse(input.configured_capacity)
    )
  }
  if (input.provider_capabilities !== undefined) {
    values.provider_capabilities = parseHostValue(() =>
      hostCapabilitiesSchema.parse(input.provider_capabilities)
    ) as Json
  }

  let query = supabase
    .from("hosts")
    .update(values)
    .eq("id", id)
    .eq("user_id", userId)

  if (options.requireUnbanned) {
    query = query.is("banned_at", null)
  }

  const { data, error } = await query
    .select(hostSelect)
    .maybeSingle()
    .returns<HostRow | null>()

  if (error) {
    throwHostWriteError(error)
  }
  if (!data) {
    throw new ServiceError("not_found", "Host not found")
  }

  const counts = await listRunningTaskCounts(supabase, [id])
  return toHostDomain(data, counts.get(id) ?? 0, options)
}

export async function recordHostHeartbeat(
  supabase: Supabase,
  userId: string,
  hostId: string,
  telemetry: HostHeartbeatTelemetry,
  options: HostProjectionOptions = {}
): Promise<HostDomain> {
  return updateHost(
    supabase,
    userId,
    hostId,
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

export async function markHostOffline(
  supabase: Supabase,
  userId: string,
  hostId: string,
  options: HostProjectionOptions = {}
): Promise<HostDomain> {
  return updateHost(
    supabase,
    userId,
    hostId,
    {
      last_seen_at: null,
      offline_since_at: (options.now ?? new Date()).toISOString(),
    },
    { ...options, requireUnbanned: true }
  )
}

export async function renameHost(
  supabase: Supabase,
  userId: string,
  hostId: string,
  input: RenameHostInput,
  options: HostProjectionOptions = {}
): Promise<HostDomain> {
  const displayName = parseHostName(input.display_name)
  const { data, error } = await supabase
    .rpc("rename_host", {
      p_user_id: userId,
      p_host_id: hostId,
      p_display_name: displayName,
      p_now: (options.now ?? new Date()).toISOString(),
    })
    .maybeSingle()
    .returns<HostRow | null>()

  const row = unwrapHostLifecycleRpc(data, error)
  const counts = await listRunningTaskCounts(supabase, [hostId])
  return toHostDomain(row, counts.get(hostId) ?? 0, options)
}

export async function banHost(
  supabase: Supabase,
  userId: string,
  hostId: string,
  options: HostProjectionOptions = {}
): Promise<HostDomain> {
  return runHostLifecycleRpc(
    supabase,
    "ban_host",
    userId,
    hostId,
    options
  )
}

export async function unbanHost(
  supabase: Supabase,
  userId: string,
  hostId: string,
  options: HostProjectionOptions = {}
): Promise<HostDomain> {
  return runHostLifecycleRpc(
    supabase,
    "unban_host",
    userId,
    hostId,
    options
  )
}

export async function deleteHost(
  supabase: Supabase,
  userId: string,
  hostId: string,
  options: {
    now?: Date
  } = {}
): Promise<void> {
  const { data, error } = await supabase
    .rpc("delete_host", {
      p_user_id: userId,
      p_host_id: hostId,
      p_now: (options.now ?? new Date()).toISOString(),
    })
    .single<boolean>()

  if (error) {
    throwHostLifecycleRpcError(error)
  }
  if (!data) {
    throw new ServiceError("not_found", "Host not found")
  }
}

async function runHostLifecycleRpc(
  supabase: Supabase,
  name: "ban_host" | "unban_host",
  userId: string,
  hostId: string,
  options: HostProjectionOptions
): Promise<HostDomain> {
  const { data, error } = await supabase
    .rpc(name, {
      p_user_id: userId,
      p_host_id: hostId,
      p_now: (options.now ?? new Date()).toISOString(),
    })
    .maybeSingle()
    .returns<HostRow | null>()

  const row = unwrapHostLifecycleRpc(data, error)
  const counts = await listRunningTaskCounts(supabase, [hostId])
  return toHostDomain(row, counts.get(hostId) ?? 0, options)
}

function unwrapHostWrite(result: {
  data: HostRow | null
  error: null | { message: string; code?: string }
}): HostRow {
  if (result.error) {
    throwHostWriteError(result.error)
  }
  if (!result.data) {
    throw new ServiceError("internal", "Host write returned no row")
  }
  return result.data
}

function unwrapHostLifecycleRpc(
  data: HostRow | null,
  error: null | { message: string; code?: string }
): HostRow {
  if (error) {
    throwHostLifecycleRpcError(error)
  }
  if (!data) {
    throw new ServiceError("not_found", "Host not found")
  }
  return data
}

function throwHostLifecycleRpcError(error: {
  message: string
  code?: string
}): never {
  if (
    error.code === "23505" ||
    error.message.toLowerCase().includes("display name is already in use") ||
    error.message.toLowerCase().includes("hosts_user_normalized_name_unique")
  ) {
    throw new ServiceError("validation", "Host display name is already in use")
  }
  if (
    error.code === "22023" ||
    error.message.toLowerCase().includes("display name must be between")
  ) {
    throw new ServiceError(
      "validation",
      "Host display name must be between 1 and 80 characters"
    )
  }

  throw new ServiceError("internal", error.message)
}

function throwHostWriteError(error: {
  message: string
  code?: string
}): never {
  if (
    error.code === "23505" ||
    error.message.toLowerCase().includes("hosts_user_normalized_name_unique")
  ) {
    throw new ServiceError("validation", "Host display name is already in use")
  }

  throw new ServiceError("internal", error.message)
}
