import * as workersService from "@gentic/services/workers"
import type { Supabase } from "@gentic/services/types"

export type SettingsWorker = {
  id: string
  editableName: string
  primaryState: workersService.WorkerPrimaryState
  genticVersion: string | null
  genticVersionHealth: workersService.WorkerVersionHealth
  runningCount: number
  configuredCapacity: number
  lastSeenAt: string | null
  os: string | null
  architecture: string | null
  processStartedAt: string | null
  connectedAt: string
  setupCompleted: boolean
  providers: workersService.WorkerDomain["providers"]
}

export type SettingsWorkersData = {
  workers: SettingsWorker[]
  summary: {
    online: number
    offline: number
    banned: number
  }
}

export async function listSettingsWorkersData(
  supabase: Supabase,
  userId: string
): Promise<SettingsWorkersData> {
  const workers = await workersService.listWorkers(supabase, userId)
  return toSettingsWorkersData(workers)
}

export function toSettingsWorkersData(
  workers: workersService.WorkerDomain[]
): SettingsWorkersData {
  const summary = {
    online: 0,
    offline: 0,
    banned: 0,
  }

  for (const worker of workers) {
    if (
      worker.primary_state === "online" ||
      worker.primary_state === "offline" ||
      worker.primary_state === "banned"
    ) {
      summary[worker.primary_state] += 1
    }
  }

  return {
    workers: workers.map(toSettingsWorker),
    summary,
  }
}

function toSettingsWorker(worker: workersService.WorkerDomain): SettingsWorker {
  return {
    id: worker.id,
    editableName: worker.display_name,
    primaryState: worker.primary_state,
    genticVersion: worker.gentic_version,
    genticVersionHealth: worker.version_health,
    runningCount: worker.running_task_count,
    configuredCapacity: worker.configured_capacity,
    lastSeenAt: worker.last_seen_at,
    os: worker.os,
    architecture: worker.arch,
    processStartedAt: worker.process_started_at,
    connectedAt: worker.created_at,
    setupCompleted: worker.setup_state === "ready",
    providers: worker.providers,
  }
}
