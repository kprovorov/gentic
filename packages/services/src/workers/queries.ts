import { ServiceError, unwrap } from "../errors"
import type { Supabase } from "../types"
import {
  toWorkerDomain,
  type WorkerDomain,
  type WorkerProjectionOptions,
} from "./domain"
import { listRunningTaskCounts, workerSelect, type WorkerRow } from "./shared"

export type WorkerControlState = {
  worker: {
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

export async function listWorkers(
  supabase: Supabase,
  userId: string,
  options: WorkerProjectionOptions = {}
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
  options: WorkerProjectionOptions = {}
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

export async function getWorkerControlState(
  supabase: Supabase,
  workerId: string,
  banned: boolean
): Promise<WorkerControlState> {
  const [rows, reviewRunRows] = await Promise.all([
    unwrap(
      await supabase
        .from("issues")
        .select("id,active_run_id,status")
        .eq("active_worker_id", workerId)
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
        .eq("claimed_by_worker_id", workerId)
        .eq("status", "running")
        .returns<Array<{ id: string; status: string }>>()
    ),
  ])

  return {
    worker: { banned },
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
