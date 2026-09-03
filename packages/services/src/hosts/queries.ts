import { ServiceError, unwrap } from "../errors"
import type { Supabase } from "../types"
import {
  toHostDomain,
  type HostDomain,
  type HostProjectionOptions,
} from "./domain"
import { listRunningTaskCounts, hostSelect, type HostRow } from "./shared"

export type HostControlState = {
  host: {
    banned: boolean
  }
  runs: Array<{
    issue_id: string
    active_run_id: string | null
    status: string
  }>
  review_runs: Array<{
    review_run_id: string
    status: string
  }>
}

export async function listHosts(
  supabase: Supabase,
  userId: string,
  options: HostProjectionOptions = {}
): Promise<HostDomain[]> {
  const rows = unwrap(
    await supabase
      .from("hosts")
      .select(hostSelect)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .returns<HostRow[]>()
  )

  const counts = await listRunningTaskCounts(
    supabase,
    rows.map((row) => row.id)
  )

  return rows.map((row) =>
    toHostDomain(row, counts.get(row.id) ?? 0, options)
  )
}

export async function getHost(
  supabase: Supabase,
  userId: string,
  id: string,
  options: HostProjectionOptions = {}
): Promise<HostDomain> {
  const { data, error } = await supabase
    .from("hosts")
    .select(hostSelect)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle()
    .returns<HostRow | null>()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (!data) {
    throw new ServiceError("not_found", "Host not found")
  }

  const counts = await listRunningTaskCounts(supabase, [id])
  return toHostDomain(data, counts.get(id) ?? 0, options)
}

export async function getHostControlState(
  supabase: Supabase,
  hostId: string,
  banned: boolean
): Promise<HostControlState> {
  const [rows, reviewRunRows] = await Promise.all([
    unwrap(
      await supabase
        .from("issues")
        .select("id,active_run_id,status")
        .eq("active_host_id", hostId)
        .not("active_run_id", "is", null)
        .not("status", "in", "(completed,cancelled)")
        .returns<
          Array<{
            id: string
            active_run_id: string | null
            status: string
          }>
        >()
    ),
    unwrap(
      await supabase
        .from("review_runs")
        .select("id,status")
        .eq("claimed_by_host_id", hostId)
        .eq("status", "running")
        .returns<Array<{ id: string; status: string }>>()
    ),
  ])

  return {
    host: { banned },
    runs: rows.map((row) => ({
      issue_id: row.id,
      active_run_id: row.active_run_id,
      status: row.status,
    })),
    review_runs: reviewRunRows.map((row) => ({
      review_run_id: row.id,
      status: row.status,
    })),
  }
}
