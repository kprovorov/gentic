import type { Tables } from "@gentic/supabase/types"
import {
  workerDisplayNameSchema,
  workerNormalizedNameSchema,
  workerPlatformSchema,
} from "@gentic/validators/workers"

import { ServiceError, unwrap } from "../errors"
import type { Supabase } from "../types"

export type WorkerRow = Tables<"workers">

export const workerSelect =
  "id,user_id,display_name,setup_state,banned_at,created_at,updated_at,last_seen_at,process_started_at,gentic_version,os,arch,configured_capacity,provider_capabilities"

export function parseWorkerValue<T>(
  parse: () => T,
  message = "Worker input is invalid"
): T {
  try {
    return parse()
  } catch {
    throw new ServiceError("validation", message)
  }
}

export function parseWorkerName(name: string): string {
  return parseWorkerValue(
    () => workerDisplayNameSchema.parse(name),
    "Worker name must be between 1 and 80 characters"
  )
}

export function parseOptionalPlatform(
  value: string | null | undefined
): string | null {
  return value === null || value === undefined
    ? null
    : parseWorkerValue(() => workerPlatformSchema.parse(value))
}

export async function ensureWorkerNameAvailable(
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

export async function listRunningTaskCounts(
  supabase: Supabase,
  workerIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()

  if (workerIds.length === 0) {
    return counts
  }

  // Implementation issues and claimed review runs share one capacity pool
  // per worker, so both are counted into the same map — this is what makes
  // "implementation work always wins capacity contention" (GEN-414) work:
  // whichever job class claims first consumes the slot the other sees.
  const [issueRows, reviewRunRows] = await Promise.all([
    unwrap(
      await supabase
        .from("issues")
        .select("active_worker_id")
        .in("active_worker_id", workerIds)
        .not("active_worker_id", "is", null)
        .not("active_run_id", "is", null)
        .not("status", "in", "(completed,cancelled)")
        .returns<Array<{ active_worker_id: string | null }>>()
    ),
    unwrap(
      await supabase
        .from("review_runs")
        .select("claimed_by_worker_id")
        .in("claimed_by_worker_id", workerIds)
        .eq("status", "running")
        .returns<Array<{ claimed_by_worker_id: string | null }>>()
    ),
  ])

  for (const row of issueRows) {
    if (row.active_worker_id) {
      counts.set(
        row.active_worker_id,
        (counts.get(row.active_worker_id) ?? 0) + 1
      )
    }
  }
  for (const row of reviewRunRows) {
    if (row.claimed_by_worker_id) {
      counts.set(
        row.claimed_by_worker_id,
        (counts.get(row.claimed_by_worker_id) ?? 0) + 1
      )
    }
  }

  return counts
}
