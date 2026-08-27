import type { Json, Tables } from "@gentic/supabase/types"
import {
  workerCapabilitiesSchema,
  type WorkerCapabilities,
} from "@gentic/validators/workers"

import {
  classifyWorkerVersion,
  type WorkerCompatibilityPolicy,
  type WorkerVersionHealth,
} from "./compatibility"
import type { WorkerRow } from "./shared"

export const WORKER_OFFLINE_AFTER_MS = 90_000

export type WorkerPrimaryState =
  "setup-incomplete" | "online" | "offline" | "banned"

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

/**
 * The two knobs every worker-returning service call accepts, because each one
 * ends in a `toWorkerDomain` projection: the clock that decides online/offline
 * and the version policy that decides version health.
 */
export type WorkerProjectionOptions = {
  now?: Date
  compatibilityPolicy?: WorkerCompatibilityPolicy
}

const supportedWorkerProviderKeys: Record<WorkerProviderKey, true> = {
  claude_code: true,
  codex: true,
}

export function toWorkerDomain(
  row: WorkerRow,
  runningTaskCount: number,
  options: WorkerProjectionOptions
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

export function sanitizeProviderCapabilities(
  capabilities: WorkerCapabilities
): WorkerCapabilities {
  const sanitized: WorkerCapabilities = { providers: {} }
  for (const key of Object.keys(capabilities.providers)) {
    if (!isSupportedWorkerProviderKey(key)) continue
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

function deriveWorkerPrimaryState(
  row: WorkerRow,
  now: Date
): WorkerPrimaryState {
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

function isSupportedWorkerProviderKey(key: string): key is WorkerProviderKey {
  return key in supportedWorkerProviderKeys
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
