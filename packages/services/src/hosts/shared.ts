import type { Tables } from "@gentic/supabase/types"
import {
  hostDisplayNameSchema,
  hostNormalizedNameSchema,
  hostPlatformSchema,
} from "@gentic/validators/hosts"

import { ServiceError, unwrap } from "../errors"
import type { Supabase } from "../types"

export type HostRow = Tables<"hosts">

export const hostSelect =
  "id,user_id,display_name,setup_state,banned_at,created_at,updated_at,last_seen_at,process_started_at,gentic_version,os,arch,configured_capacity,provider_capabilities"

export function parseHostValue<T>(
  parse: () => T,
  message = "Host input is invalid"
): T {
  try {
    return parse()
  } catch {
    throw new ServiceError("validation", message)
  }
}

export function parseHostName(name: string): string {
  return parseHostValue(
    () => hostDisplayNameSchema.parse(name),
    "Host display name must be between 1 and 80 characters"
  )
}

export function parseOptionalPlatform(
  value: string | null | undefined
): string | null {
  return value === null || value === undefined
    ? null
    : parseHostValue(() => hostPlatformSchema.parse(value))
}

export async function ensureHostNameAvailable(
  supabase: Supabase,
  userId: string,
  displayName: string,
  exceptHostId?: string
): Promise<void> {
  let query = supabase
    .from("hosts")
    .select("id")
    .eq("user_id", userId)
    .eq("normalized_name", hostNormalizedNameSchema.parse(displayName))

  if (exceptHostId) {
    query = query.neq("id", exceptHostId)
  }

  const { data, error } = await query.maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (data) {
    throw new ServiceError("validation", "Host display name is already in use")
  }
}

export async function listRunningTaskCounts(
  supabase: Supabase,
  hostIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()

  if (hostIds.length === 0) {
    return counts
  }

  // Implementation issues and claimed review runs share one capacity pool
  // per host, so both are counted into the same map — this is what makes
  // "implementation work always wins capacity contention" (GEN-414) work:
  // whichever job class claims first consumes the slot the other sees.
  const [issueRows, reviewRunRows] = await Promise.all([
    unwrap(
      await supabase
        .from("issues")
        .select("active_host_id")
        .in("active_host_id", hostIds)
        .not("active_host_id", "is", null)
        .not("active_run_id", "is", null)
        .not("status", "in", "(completed,cancelled)")
        .returns<Array<{ active_host_id: string | null }>>()
    ),
    unwrap(
      await supabase
        .from("review_runs")
        .select("claimed_by_host_id")
        .in("claimed_by_host_id", hostIds)
        .eq("status", "running")
        .returns<Array<{ claimed_by_host_id: string | null }>>()
    ),
  ])

  for (const row of issueRows) {
    if (row.active_host_id) {
      counts.set(
        row.active_host_id,
        (counts.get(row.active_host_id) ?? 0) + 1
      )
    }
  }
  for (const row of reviewRunRows) {
    if (row.claimed_by_host_id) {
      counts.set(
        row.claimed_by_host_id,
        (counts.get(row.claimed_by_host_id) ?? 0) + 1
      )
    }
  }

  return counts
}
