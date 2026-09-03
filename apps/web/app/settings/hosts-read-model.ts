import * as hostsService from "@gentic/services/hosts"
import type { Supabase } from "@gentic/services/types"

export type SettingsHost = {
  id: string
  editableName: string
  primaryState: hostsService.HostPrimaryState
  genticVersion: string | null
  genticVersionHealth: hostsService.HostVersionHealth
  runningCount: number
  configuredCapacity: number
  lastSeenAt: string | null
  os: string | null
  architecture: string | null
  processStartedAt: string | null
  connectedAt: string
  setupCompleted: boolean
  providers: hostsService.HostDomain["providers"]
}

export type SettingsHostsData = {
  hosts: SettingsHost[]
  summary: {
    online: number
    offline: number
    banned: number
  }
}

export async function listSettingsHostsData(
  supabase: Supabase,
  userId: string
): Promise<SettingsHostsData> {
  const hosts = await hostsService.listHosts(supabase, userId)
  return toSettingsHostsData(hosts)
}

export function toSettingsHostsData(
  hosts: hostsService.HostDomain[]
): SettingsHostsData {
  const summary = {
    online: 0,
    offline: 0,
    banned: 0,
  }

  for (const host of hosts) {
    if (
      host.primary_state === "online" ||
      host.primary_state === "offline" ||
      host.primary_state === "banned"
    ) {
      summary[host.primary_state] += 1
    }
  }

  return {
    hosts: hosts.map(toSettingsHost),
    summary,
  }
}

function toSettingsHost(host: hostsService.HostDomain): SettingsHost {
  return {
    id: host.id,
    editableName: host.display_name,
    primaryState: host.primary_state,
    genticVersion: host.gentic_version,
    genticVersionHealth: host.version_health,
    runningCount: host.running_task_count,
    configuredCapacity: host.configured_capacity,
    lastSeenAt: host.last_seen_at,
    os: host.os,
    architecture: host.arch,
    processStartedAt: host.process_started_at,
    connectedAt: host.created_at,
    setupCompleted: host.setup_state === "ready",
    providers: host.providers,
  }
}
