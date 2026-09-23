import type { Tables } from "@gentic/supabase/types"
import {
  createHostToolUpdateInputSchema,
  reportHostToolUpdateResultInputSchema,
  sanitizeHostToolUpdateOutput,
  type CreateHostToolUpdateInput,
  type HostTool,
  type HostToolUpdateStatus,
  type ReportHostToolUpdateResultInput,
} from "@gentic/validators/host-tool-updates"

import { ServiceError, unwrap } from "./errors"
import { getHost, type HostDomain } from "./hosts"
import type { Supabase } from "./types"

/**
 * How long a submitted command stays claimable by its host, and how long a
 * claimed one may run. Longer than a skill install because several tools can
 * be queued at once and a package-manager upgrade can take minutes each.
 */
export const HOST_TOOL_UPDATE_TTL_MS = 30 * 60 * 1000

/**
 * How long a row survives after submission. Past this the command state is
 * swept: results are transient by design, and Gentic keeps no update history.
 */
export const HOST_TOOL_UPDATE_RETENTION_MS = 60 * 60 * 1000

export type HostToolUpdateDomain = {
  id: string
  host_id: string
  tool: HostTool
  status: HostToolUpdateStatus
  summary: string | null
  output: string | null
  version: string | null
  created_at: string
  expires_at: string
}

export type HostToolUpdateCommandDomain = {
  id: string
  tool: HostTool
  expires_at: string
}

export type HostToolUpdateIneligibilityReason =
  "offline" | "banned" | "setup-incomplete"

type HostToolUpdateRow = Tables<"host_tool_updates">

const updateSelect =
  "id,host_id,tool,status,summary,output,version,created_at,expires_at"

const activeStatuses = ["waiting", "updating"] as const

/** A host can be targeted only while it is online, unbanned and set up. */
export function hostToolUpdateIneligibilityReason(
  host: Pick<HostDomain, "primary_state">
): HostToolUpdateIneligibilityReason | null {
  if (host.primary_state === "banned") return "banned"
  if (host.primary_state === "setup-incomplete") return "setup-incomplete"
  if (host.primary_state === "offline") return "offline"
  return null
}

/**
 * Queues one tool update for one host. Ownership and eligibility are checked
 * here — the dialog's disabled buttons are a convenience, not the authority.
 * Several tools may be queued at once; the same tool twice conflicts.
 */
export async function createHostToolUpdate(
  supabase: Supabase,
  userId: string,
  hostId: string,
  input: CreateHostToolUpdateInput,
  options: { now?: Date } = {}
): Promise<HostToolUpdateDomain> {
  const fields = parseWithSchema(
    () => createHostToolUpdateInputSchema.parse(input),
    "Invalid tool update request"
  )
  const now = options.now ?? new Date()

  await expireHostToolUpdates(supabase, { now })

  const host = await getHost(supabase, userId, hostId, { now })
  const reason = hostToolUpdateIneligibilityReason(host)
  if (reason) {
    throw new ServiceError(
      "conflict",
      `${host.display_name} cannot be updated right now (${ineligibilityMessages[reason]}).`
    )
  }

  const expiresAt = new Date(now.getTime() + HOST_TOOL_UPDATE_TTL_MS)
  const result = await supabase
    .from("host_tool_updates")
    .insert({
      user_id: userId,
      host_id: hostId,
      tool: fields.tool,
      status: "waiting",
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    })
    .select(updateSelect)
    .returns<HostToolUpdateRow[]>()

  if (result.error) {
    throw toUpdateWriteError(result.error, fields.tool)
  }

  const row = result.data?.[0]
  if (!row) {
    throw new ServiceError("internal", "Tool update was not recorded")
  }

  return toUpdateDomain(row)
}

/**
 * Every command still on record for one host, oldest first. Powers the
 * dialog's poll; because rows outlive their run by the retention window,
 * reopening the dialog shows what happened a few minutes ago.
 */
export async function listHostToolUpdates(
  supabase: Supabase,
  userId: string,
  hostId: string,
  options: { now?: Date } = {}
): Promise<HostToolUpdateDomain[]> {
  await expireHostToolUpdates(supabase, { now: options.now })

  const rows = unwrap(
    await supabase
      .from("host_tool_updates")
      .select(updateSelect)
      .eq("user_id", userId)
      .eq("host_id", hostId)
      .order("created_at", { ascending: true })
      .returns<HostToolUpdateRow[]>()
  )

  return rows.map(toUpdateDomain)
}

/**
 * Hands a host its oldest pending command, exactly once, and only while it
 * has nothing else updating. The conditional update is the claim: two
 * concurrent polls contend on the same row and only one sees it in
 * `waiting`; the one-updating-per-host index refuses the other even if it
 * picked a different row.
 */
export async function claimHostToolUpdate(
  supabase: Supabase,
  hostId: string,
  options: { now?: Date } = {}
): Promise<HostToolUpdateCommandDomain | null> {
  const now = options.now ?? new Date()
  await expireHostToolUpdates(supabase, { now })

  const updating = unwrap(
    await supabase
      .from("host_tool_updates")
      .select("id")
      .eq("host_id", hostId)
      .eq("status", "updating")
      .returns<Array<{ id: string }>>()
  )
  if (updating.length > 0) {
    return null
  }

  const waiting = unwrap(
    await supabase
      .from("host_tool_updates")
      .select("id")
      .eq("host_id", hostId)
      .eq("status", "waiting")
      .gt("expires_at", now.toISOString())
      .order("created_at", { ascending: true })
      .limit(1)
      .returns<Array<{ id: string }>>()
  )
  const next = waiting[0]
  if (!next) {
    return null
  }

  const claimed = await supabase
    .from("host_tool_updates")
    .update({
      status: "updating",
      accepted_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", next.id)
    .eq("host_id", hostId)
    .eq("status", "waiting")
    .select("id,tool,expires_at")
    .returns<Array<Pick<HostToolUpdateRow, "id" | "tool" | "expires_at">>>()

  if (claimed.error) {
    // Another poll won the one-updating-per-host race; this poll simply has
    // nothing to run right now.
    if (claimed.error.code === "23505") {
      return null
    }
    throw new ServiceError("internal", claimed.error.message)
  }

  const row = claimed.data?.[0]
  return row
    ? { id: row.id, tool: row.tool as HostTool, expires_at: row.expires_at }
    : null
}

/**
 * Records the outcome the host reports. Accepted only for a command this
 * host actually claimed, and only once — there is no retry path, so a second
 * report has nothing to update.
 */
export async function reportHostToolUpdateResult(
  supabase: Supabase,
  hostId: string,
  updateId: string,
  input: ReportHostToolUpdateResultInput,
  options: { now?: Date } = {}
): Promise<HostToolUpdateDomain> {
  const fields = parseWithSchema(
    () => reportHostToolUpdateResultInputSchema.parse(input),
    "Invalid tool update result"
  )
  const now = options.now ?? new Date()

  const rows = unwrap(
    await supabase
      .from("host_tool_updates")
      .update({
        status: fields.status,
        summary: sanitizeOptionalText(fields.summary, 500),
        output: sanitizeOptionalText(fields.output, 20_000),
        version: fields.version ?? null,
        finished_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", updateId)
      .eq("host_id", hostId)
      .eq("status", "updating")
      .select(updateSelect)
      .returns<HostToolUpdateRow[]>()
  )

  if (rows.length === 0) {
    throw new ServiceError("not_found", "Tool update command not found")
  }

  return toUpdateDomain(rows[0])
}

/**
 * Lazy sweep of transient command state, run at the head of every entry
 * point: commands nobody claimed or finished in time become `timed-out`, and
 * everything past the retention window is deleted so no history accumulates.
 */
export async function expireHostToolUpdates(
  supabase: Supabase,
  options: { now?: Date } = {}
): Promise<void> {
  const now = options.now ?? new Date()

  const expired = await supabase
    .from("host_tool_updates")
    .update({
      status: "timed-out",
      finished_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .in("status", [...activeStatuses])
    .lte("expires_at", now.toISOString())

  if (expired.error) {
    throw new ServiceError("internal", expired.error.message)
  }

  const purged = await supabase
    .from("host_tool_updates")
    .delete()
    .lte(
      "created_at",
      new Date(now.getTime() - HOST_TOOL_UPDATE_RETENTION_MS).toISOString()
    )

  if (purged.error) {
    throw new ServiceError("internal", purged.error.message)
  }
}

const ineligibilityMessages: Record<HostToolUpdateIneligibilityReason, string> =
  {
    offline: "offline",
    banned: "banned",
    "setup-incomplete": "setup incomplete",
  }

export const hostToolLabels: Record<HostTool, string> = {
  gentic: "Gentic",
  claude_code: "Claude Code",
  codex: "Codex",
  github: "GitHub CLI",
}

function toUpdateDomain(row: HostToolUpdateRow): HostToolUpdateDomain {
  return {
    id: row.id,
    host_id: row.host_id,
    tool: row.tool as HostTool,
    status: row.status as HostToolUpdateStatus,
    summary: row.summary,
    output: row.output,
    version: row.version,
    created_at: row.created_at,
    expires_at: row.expires_at,
  }
}

function parseWithSchema<T>(parse: () => T, message: string): T {
  try {
    return parse()
  } catch {
    throw new ServiceError("validation", message)
  }
}

function sanitizeOptionalText(
  value: string | null | undefined,
  maxLength: number
): string | null {
  if (value === null || value === undefined) {
    return null
  }

  const sanitized = sanitizeHostToolUpdateOutput(value).slice(0, maxLength)
  return sanitized.length > 0 ? sanitized : null
}

function toUpdateWriteError(
  error: { message: string; code?: string },
  tool: HostTool
): ServiceError {
  if (
    error.code === "23505" ||
    error.message.includes("host_tool_updates_one_pending_per_tool")
  ) {
    return new ServiceError(
      "conflict",
      `${hostToolLabels[tool]} is already being updated on this host.`
    )
  }
  if (
    error.code === "23503" ||
    error.message.includes("host_tool_updates_host_owner")
  ) {
    return new ServiceError("not_found", "Host not found")
  }

  return new ServiceError("internal", error.message)
}
