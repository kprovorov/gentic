import type { Json, Tables } from "@gentic/supabase/types"
import {
  hostCapabilitiesSchema,
  type HostCapabilities,
} from "@gentic/validators/hosts"

import {
  classifyHostVersion,
  type HostCompatibilityPolicy,
  type HostVersionHealth,
} from "./compatibility"
import type { HostRow } from "./shared"

export const HOST_OFFLINE_AFTER_MS = 90_000

export type HostPrimaryState =
  "setup-incomplete" | "online" | "offline" | "banned"

export type HostProviderReadiness = {
  installed: boolean
  authenticated: boolean | null
  version: string | null
}

type HostProviderKey = keyof HostCapabilities["providers"]

export type HostDomain = Pick<
  Tables<"hosts">,
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
  primary_state: HostPrimaryState
  version_health: HostVersionHealth
  providers: Record<HostProviderKey, HostProviderReadiness | null>
  running_task_count: number
}

/**
 * The two knobs every host-returning service call accepts, because each one
 * ends in a `toHostDomain` projection: the clock that decides online/offline
 * and the version policy that decides version health.
 */
export type HostProjectionOptions = {
  now?: Date
  compatibilityPolicy?: HostCompatibilityPolicy
}

const supportedHostProviderKeys: Record<HostProviderKey, true> = {
  claude_code: true,
  codex: true,
}

export function toHostDomain(
  row: HostRow,
  runningTaskCount: number,
  options: HostProjectionOptions
): HostDomain {
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
    primary_state: deriveHostPrimaryState(row, options.now ?? new Date()),
    version_health: classifyHostVersion(
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
  capabilities: HostCapabilities
): HostCapabilities {
  const sanitized: HostCapabilities = { providers: {} }
  for (const key of Object.keys(capabilities.providers)) {
    if (!isSupportedHostProviderKey(key)) continue
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

function deriveHostPrimaryState(
  row: HostRow,
  now: Date
): HostPrimaryState {
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
    HOST_OFFLINE_AFTER_MS
    ? "online"
    : "offline"
}

function parseCapabilities(value: Json): HostCapabilities {
  const result = hostCapabilitiesSchema.safeParse(value)
  return result.success ? result.data : { providers: {} }
}

function isSupportedHostProviderKey(key: string): key is HostProviderKey {
  return key in supportedHostProviderKeys
}

function toProviderReadiness(
  capability: HostCapabilities["providers"][HostProviderKey]
): HostProviderReadiness | null {
  if (!capability) {
    return null
  }

  return {
    installed: capability.available,
    authenticated: capability.authenticated,
    version: capability.version,
  }
}
