import type { Tables } from "@gentic/supabase/types"
import {
  createHostSkillInstallsInputSchema,
  parseSkillsShSkillUrl,
  reportHostSkillInstallResultInputSchema,
  sanitizeSkillInstallOutput,
  skillAuditsResponseSchema,
  SkillUrlError,
  type CreateHostSkillInstallsInput,
  type ReportHostSkillInstallResultInput,
  type SkillAudit,
  type SkillAuditGate,
  type SkillAuditGateReason,
  type SkillReference,
  type HostSkillInstallStatus,
} from "@gentic/validators/skills"

import { ServiceError, unwrap } from "./errors"
import type { Supabase } from "./types"
import { listHosts, type HostDomain } from "./hosts"

/** How long a submitted command stays claimable by its host. */
export const SKILL_INSTALL_TTL_MS = 10 * 60 * 1000

/**
 * How long a row survives after submission. Past this the command state is
 * swept: results are transient by design, and Gentic keeps no install history.
 */
export const SKILL_INSTALL_RETENTION_MS = 20 * 60 * 1000

/** Audits older than this stop counting as current and require confirmation. */
export const SKILL_AUDIT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export const SKILLS_SH_AUDIT_API = "https://www.skills.sh/api/v1/skills/audit"

const SKILL_AUDIT_TIMEOUT_MS = 8_000

type Fetch = typeof globalThis.fetch

export type SkillAuditLookup =
  | { outcome: "audited"; audits: SkillAudit[] }
  | { outcome: "missing" }
  | { outcome: "unavailable" }

export type HostSkillInstallDomain = {
  id: string
  host_id: string
  source: string
  skill: string
  url: string
  status: HostSkillInstallStatus
  error_summary: string | null
  output: string | null
  expires_at: string
}

export type HostSkillInstallCommandDomain = {
  id: string
  source: string
  skill: string
  expires_at: string
}

export type CreateHostSkillInstallsResult = {
  skill: SkillReference
  gate: SkillAuditGate
  installs: HostSkillInstallDomain[]
}

/**
 * Thrown when the audit gate refuses a submission. Carries the gate so the
 * caller can re-render the audit panel the user has to act on rather than
 * showing a bare error string.
 */
export class SkillAuditGateError extends ServiceError {
  readonly gate: SkillAuditGate

  constructor(message: string, gate: SkillAuditGate) {
    super("conflict", message)
    this.name = "SkillAuditGateError"
    this.gate = gate
  }
}

type HostSkillInstallRow = Tables<"host_skill_installs">

const installSelect =
  "id,host_id,source,skill,url,status,error_summary,output,expires_at"

const activeStatuses = ["waiting", "installing"] as const

/**
 * Reads the current skills.sh audits for one skill. A missing audit record and
 * an unreachable registry are distinct outcomes: both merely require explicit
 * risk acceptance, so neither is allowed to fail the whole request.
 */
export async function fetchSkillAudits(
  skill: Pick<SkillReference, "source" | "skill">,
  options: { fetchImpl?: Fetch; signal?: AbortSignal } = {}
): Promise<SkillAuditLookup> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const url = `${SKILLS_SH_AUDIT_API}/${skill.source}/${skill.skill}`

  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: options.signal ?? AbortSignal.timeout(SKILL_AUDIT_TIMEOUT_MS),
    })

    if (response.status === 404) {
      return { outcome: "missing" }
    }
    if (!response.ok) {
      return { outcome: "unavailable" }
    }

    const parsed = skillAuditsResponseSchema.safeParse(await response.json())
    if (!parsed.success) {
      return { outcome: "unavailable" }
    }

    return parsed.data.audits.length === 0
      ? { outcome: "missing" }
      : { outcome: "audited", audits: parsed.data.audits }
  } catch {
    return { outcome: "unavailable" }
  }
}

/**
 * Turns audit results into the gate the UI renders and the dispatch path
 * enforces: a failing audit blocks outright, anything short of a full set of
 * current passing audits needs the user to accept the risk explicitly.
 */
export function evaluateSkillAudits(
  lookup: SkillAuditLookup,
  options: { now?: Date } = {}
): SkillAuditGate {
  if (lookup.outcome === "missing") {
    return { decision: "confirm", reasons: ["missing"], audits: [] }
  }
  if (lookup.outcome === "unavailable") {
    return { decision: "confirm", reasons: ["unavailable"], audits: [] }
  }

  const now = (options.now ?? new Date()).getTime()
  const reasons = new Set<SkillAuditGateReason>()

  for (const audit of lookup.audits) {
    if (audit.status === "fail") {
      reasons.add("failed")
    } else if (audit.status === "warn") {
      reasons.add("warning")
    }

    const auditedAt = audit.auditedAt ? Date.parse(audit.auditedAt) : Number.NaN
    if (Number.isNaN(auditedAt) || now - auditedAt > SKILL_AUDIT_MAX_AGE_MS) {
      reasons.add("stale")
    }
  }

  const ordered = (
    ["failed", "warning", "stale", "missing", "unavailable"] as const
  ).filter((reason) => reasons.has(reason))

  return {
    decision: reasons.has("failed")
      ? "block"
      : ordered.length > 0
        ? "confirm"
        : "allow",
    reasons: ordered,
    audits: lookup.audits,
  }
}

export async function resolveSkillAuditGate(
  skill: Pick<SkillReference, "source" | "skill">,
  options: { fetchImpl?: Fetch; now?: Date; signal?: AbortSignal } = {}
): Promise<SkillAuditGate> {
  return evaluateSkillAudits(await fetchSkillAudits(skill, options), options)
}

export function parseSkillUrl(url: string): SkillReference {
  try {
    return parseSkillsShSkillUrl(url)
  } catch (error) {
    throw new ServiceError(
      "validation",
      error instanceof SkillUrlError ? error.message : "Invalid skill URL"
    )
  }
}

export type SkillInstallTargetReason =
  | "offline"
  | "banned"
  | "setup-incomplete"
  | "installing"

export type SkillInstallTarget = {
  host_id: string
  display_name: string
  eligible: boolean
  reason: SkillInstallTargetReason | null
}

/**
 * Every existing host with the eligibility the dispatch path will enforce.
 * Ineligible hosts stay in the list with their reason rather than vanishing,
 * so the dialog can explain why a machine cannot be targeted.
 */
export async function listSkillInstallTargets(
  supabase: Supabase,
  userId: string,
  options: { now?: Date } = {}
): Promise<SkillInstallTarget[]> {
  const now = options.now ?? new Date()
  await expireHostSkillInstalls(supabase, { now })

  const hosts = await listHosts(supabase, userId, { now })
  const activeHostIds = await listActiveInstallHostIds(
    supabase,
    userId,
    hosts.map((host) => host.id)
  )

  return hosts.map((host) => {
    const reason = skillInstallIneligibilityReason(
      host,
      activeHostIds.has(host.id)
    )

    return {
      host_id: host.id,
      display_name: host.display_name,
      eligible: reason === null,
      reason,
    }
  })
}

/** A host can be targeted only while it is online, unbanned, set up and idle. */
export function skillInstallIneligibilityReason(
  host: HostDomain,
  hasActiveInstall: boolean
): "offline" | "banned" | "setup-incomplete" | "installing" | null {
  if (host.primary_state === "banned") return "banned"
  if (host.primary_state === "setup-incomplete") return "setup-incomplete"
  if (host.primary_state === "offline") return "offline"
  if (hasActiveInstall) return "installing"
  return null
}

/**
 * Dispatches one skill install to the selected hosts. Ownership, eligibility
 * and the audit gate are all re-checked here — the dialog's checkboxes and
 * risk acknowledgement are conveniences, not the authority.
 */
export async function createHostSkillInstalls(
  supabase: Supabase,
  userId: string,
  input: CreateHostSkillInstallsInput,
  options: { now?: Date; fetchImpl?: Fetch } = {}
): Promise<CreateHostSkillInstallsResult> {
  const fields = parseCreateInput(input)
  const skill = parseSkillUrl(fields.url)
  const now = options.now ?? new Date()

  await expireHostSkillInstalls(supabase, { now })

  const hosts = await listHosts(supabase, userId, { now })
  const activeHostIds = await listActiveInstallHostIds(
    supabase,
    userId,
    fields.host_ids
  )
  const requested = new Set(fields.host_ids)
  const byId = new Map(hosts.map((host) => [host.id, host]))

  for (const hostId of requested) {
    const host = byId.get(hostId)
    if (!host) {
      throw new ServiceError("not_found", "Host not found")
    }

    const reason = skillInstallIneligibilityReason(
      host,
      activeHostIds.has(hostId)
    )
    if (reason) {
      throw new ServiceError(
        "conflict",
        `${host.display_name} can no longer be installed to (${ineligibilityMessages[reason]}).`
      )
    }
  }

  // Re-read the audits immediately before dispatch rather than trusting
  // whatever the dialog was shown when the URL was pasted.
  const gate = await resolveSkillAuditGate(skill, {
    fetchImpl: options.fetchImpl,
    now,
  })

  if (gate.decision === "block") {
    throw new SkillAuditGateError(
      "A security audit failed for this skill, so it cannot be installed.",
      gate
    )
  }
  if (gate.decision === "confirm" && !fields.accept_risk) {
    throw new SkillAuditGateError(
      "This skill's audits are not all current and passing. Accept the risk to continue.",
      gate
    )
  }

  const expiresAt = new Date(now.getTime() + SKILL_INSTALL_TTL_MS)
  const result = await supabase
    .from("host_skill_installs")
    .insert(
      fields.host_ids.map((hostId) => ({
        user_id: userId,
        host_id: hostId,
        source: skill.source,
        skill: skill.skill,
        url: skill.url,
        status: "waiting",
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      }))
    )
    .select(installSelect)
    .returns<HostSkillInstallRow[]>()

  if (result.error) {
    throw toInstallWriteError(result.error)
  }

  return {
    skill,
    gate,
    installs: (result.data ?? []).map(toInstallDomain),
  }
}

/** Powers the dialog's live result poll for the commands it just submitted. */
export async function listHostSkillInstalls(
  supabase: Supabase,
  userId: string,
  installIds: string[],
  options: { now?: Date } = {}
): Promise<HostSkillInstallDomain[]> {
  if (installIds.length === 0) {
    return []
  }

  await expireHostSkillInstalls(supabase, { now: options.now })

  const rows = unwrap(
    await supabase
      .from("host_skill_installs")
      .select(installSelect)
      .eq("user_id", userId)
      .in("id", installIds)
      .returns<HostSkillInstallRow[]>()
  )

  return rows.map(toInstallDomain)
}

/**
 * Hands a host its own pending command, exactly once. The conditional update
 * is the claim: two concurrent polls contend on the same row and only one sees
 * it in `waiting`, so an accepted command is never re-delivered.
 */
export async function claimHostSkillInstall(
  supabase: Supabase,
  hostId: string,
  options: { now?: Date } = {}
): Promise<HostSkillInstallCommandDomain | null> {
  const now = options.now ?? new Date()
  await expireHostSkillInstalls(supabase, { now })

  const rows = unwrap(
    await supabase
      .from("host_skill_installs")
      .update({
        status: "installing",
        accepted_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("host_id", hostId)
      .eq("status", "waiting")
      .gt("expires_at", now.toISOString())
      .select("id,source,skill,expires_at")
      .returns<
        Array<Pick<HostSkillInstallRow, "id" | "source" | "skill" | "expires_at">>
      >()
  )

  const claimed = rows[0]
  return claimed
    ? {
        id: claimed.id,
        source: claimed.source,
        skill: claimed.skill,
        expires_at: claimed.expires_at,
      }
    : null
}

/**
 * Records the outcome the host reports. Accepted only for a command this
 * host actually claimed, and only once — there is no retry path, so a second
 * report has nothing to update.
 */
export async function reportHostSkillInstallResult(
  supabase: Supabase,
  hostId: string,
  installId: string,
  input: ReportHostSkillInstallResultInput,
  options: { now?: Date } = {}
): Promise<HostSkillInstallDomain> {
  const fields = parseWithSchema(
    () => reportHostSkillInstallResultInputSchema.parse(input),
    "Invalid skill install result"
  )
  const now = options.now ?? new Date()

  const rows = unwrap(
    await supabase
      .from("host_skill_installs")
      .update({
        status: fields.status,
        error_summary: sanitizeOptionalText(fields.error_summary, 500),
        output: sanitizeOptionalText(fields.output, 20_000),
        finished_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", installId)
      .eq("host_id", hostId)
      .eq("status", "installing")
      .select(installSelect)
      .returns<HostSkillInstallRow[]>()
  )

  if (rows.length === 0) {
    throw new ServiceError("not_found", "Skill install command not found")
  }

  return toInstallDomain(rows[0])
}

/**
 * Lazy sweep of transient command state, run at the head of every entry point:
 * commands nobody claimed in time become `timed-out`, and everything past the
 * retention window is deleted so no install history accumulates.
 */
export async function expireHostSkillInstalls(
  supabase: Supabase,
  options: { now?: Date } = {}
): Promise<void> {
  const now = options.now ?? new Date()

  const expired = await supabase
    .from("host_skill_installs")
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
    .from("host_skill_installs")
    .delete()
    .lte(
      "created_at",
      new Date(now.getTime() - SKILL_INSTALL_RETENTION_MS).toISOString()
    )

  if (purged.error) {
    throw new ServiceError("internal", purged.error.message)
  }
}

const ineligibilityMessages = {
  offline: "offline",
  banned: "banned",
  "setup-incomplete": "setup incomplete",
  installing: "already installing a skill",
} as const

async function listActiveInstallHostIds(
  supabase: Supabase,
  userId: string,
  hostIds: string[]
): Promise<Set<string>> {
  if (hostIds.length === 0) {
    return new Set()
  }

  const rows = unwrap(
    await supabase
      .from("host_skill_installs")
      .select("host_id")
      .eq("user_id", userId)
      .in("host_id", hostIds)
      .in("status", [...activeStatuses])
      .returns<Array<{ host_id: string }>>()
  )

  return new Set(rows.map((row) => row.host_id))
}

function toInstallDomain(row: HostSkillInstallRow): HostSkillInstallDomain {
  return {
    id: row.id,
    host_id: row.host_id,
    source: row.source,
    skill: row.skill,
    url: row.url,
    status: row.status as HostSkillInstallStatus,
    error_summary: row.error_summary,
    output: row.output,
    expires_at: row.expires_at,
  }
}

function parseCreateInput(
  input: CreateHostSkillInstallsInput
): CreateHostSkillInstallsInput & { accept_risk: boolean } {
  const fields = parseWithSchema(
    () => createHostSkillInstallsInputSchema.parse(input),
    "Invalid skill install request"
  )

  return { ...fields, host_ids: [...new Set(fields.host_ids)] }
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

  const sanitized = sanitizeSkillInstallOutput(value).slice(0, maxLength)
  return sanitized.length > 0 ? sanitized : null
}

function toInstallWriteError(error: {
  message: string
  code?: string
}): ServiceError {
  if (
    error.code === "23505" ||
    error.message.includes("host_skill_installs_one_active_per_host")
  ) {
    return new ServiceError(
      "conflict",
      "A skill is already being installed on one of the selected hosts."
    )
  }
  if (
    error.code === "23503" ||
    error.message.includes("host_skill_installs_host_owner")
  ) {
    return new ServiceError("not_found", "Host not found")
  }

  return new ServiceError("internal", error.message)
}
