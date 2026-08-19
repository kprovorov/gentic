import type { AgentProvider, IssueModel } from "@gentic/validators/issues"

import { ServiceError } from "../errors"
import type { Supabase } from "../types"

// How an implementation owner came to be. `implementation` is the original
// session that produced the pull-request changes; `fresh_implementation` is a
// user-initiated restart that established a new owner generation.
export type ImplementationOwnerOrigin = "implementation" | "fresh_implementation"

// Stable, machine-readable reasons an owner cannot be resumed. Suitable for
// driving UI recovery controls (each maps to a distinct recovery affordance).
export const IMPLEMENTATION_OWNER_UNAVAILABLE_REASONS = [
  // The issue's agent provider or model changed, invalidating the session.
  "provider_changed",
  // No resumable ACP session was ever persisted for this owner (e.g. a
  // fresh-implementation owner still waiting for its first run).
  "session_missing",
  // The owning worker was deleted.
  "worker_deleted",
  // The owning worker is banned.
  "worker_banned",
] as const

export type ImplementationOwnerUnavailableReason =
  (typeof IMPLEMENTATION_OWNER_UNAVAILABLE_REASONS)[number]

export type ImplementationOwner = {
  id: string
  issueId: string
  generation: number
  origin: ImplementationOwnerOrigin
  workerId: string | null
  sessionId: string | null
  agentProvider: AgentProvider
  issueModel: IssueModel
  establishedAt: string
  /** True when the recorded session can be handed a review fix right now. */
  resumable: boolean
  /** Set iff `resumable` is false. */
  unavailableReason: ImplementationOwnerUnavailableReason | null
}

// The target a review fix is being handed to, as the caller understands it.
export type FixHandoffTarget = {
  workerId: string
  sessionId: string
  /** When provided, the owner generation must match too. */
  generation?: number
}

export type FixHandoffRejectionReason =
  | ImplementationOwnerUnavailableReason
  // No implementation owner is recorded for this issue yet.
  | "no_owner"
  // The target is not the current implementation owner.
  | "not_owner"

export type FixHandoffValidation =
  | { ok: true; owner: ImplementationOwner }
  | {
      ok: false
      reason: FixHandoffRejectionReason
      owner: ImplementationOwner | null
    }

type OwnerRow = {
  id: string
  issue_id: string
  generation: number
  origin: ImplementationOwnerOrigin
  worker_id: string | null
  session_id: string | null
  agent_provider: AgentProvider
  issue_model: IssueModel
  established_at: string
  issues: { agent_provider: AgentProvider; issue_model: IssueModel }
  workers: { banned_at: string | null } | null
}

const OWNER_SELECT =
  "id, issue_id, generation, origin, worker_id, session_id, agent_provider, issue_model, established_at, issues!inner(agent_provider, issue_model), workers(banned_at)"

// Availability is derived from the live worker + issue rows rather than stored,
// so ban/delete/offline and provider changes are reflected the moment they
// happen without the ownership row needing to be rewritten.
function deriveAvailability(row: OwnerRow): {
  resumable: boolean
  unavailableReason: ImplementationOwnerUnavailableReason | null
} {
  const providerChanged =
    row.agent_provider !== row.issues.agent_provider ||
    (row.issue_model ?? null) !== (row.issues.issue_model ?? null)

  if (providerChanged) {
    return { resumable: false, unavailableReason: "provider_changed" }
  }
  if (!row.session_id) {
    return { resumable: false, unavailableReason: "session_missing" }
  }
  if (!row.worker_id) {
    return { resumable: false, unavailableReason: "worker_deleted" }
  }
  if (row.workers?.banned_at) {
    return { resumable: false, unavailableReason: "worker_banned" }
  }
  return { resumable: true, unavailableReason: null }
}

function toOwner(row: OwnerRow): ImplementationOwner {
  const { resumable, unavailableReason } = deriveAvailability(row)
  return {
    id: row.id,
    issueId: row.issue_id,
    generation: row.generation,
    origin: row.origin,
    workerId: row.worker_id,
    sessionId: row.session_id,
    agentProvider: row.agent_provider,
    issueModel: row.issue_model,
    establishedAt: row.established_at,
    resumable,
    unavailableReason,
  }
}

// Resolves the current implementation owner for an issue, or null if none has
// been recorded yet. Trusted server code (agent API, webhook handlers) that
// already established authorization can call this directly; a user-facing
// caller should pass a client scoped by RLS.
export async function resolveImplementationOwner(
  supabase: Supabase,
  issueId: string
): Promise<ImplementationOwner | null> {
  const { data, error } = await supabase
    .from("issue_implementation_owners")
    .select(OWNER_SELECT)
    .eq("issue_id", issueId)
    .is("superseded_at", null)
    .maybeSingle<OwnerRow>()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  return data ? toOwner(data) : null
}

// Validates that a review fix handoff targets the current implementation owner
// and that the owner can actually be resumed. A handoff to any other session,
// or to an unavailable owner, is rejected with a stable reason — leaving the
// issue to wait for human action rather than silently picking a new owner.
export async function validateFixHandoff(
  supabase: Supabase,
  issueId: string,
  target: FixHandoffTarget
): Promise<FixHandoffValidation> {
  const owner = await resolveImplementationOwner(supabase, issueId)

  if (!owner) {
    return { ok: false, reason: "no_owner", owner: null }
  }

  const targetsOwner =
    owner.workerId === target.workerId &&
    owner.sessionId === target.sessionId &&
    (target.generation === undefined || owner.generation === target.generation)

  if (!targetsOwner) {
    return { ok: false, reason: "not_owner", owner }
  }
  if (!owner.resumable) {
    // `unavailableReason` is always set when `resumable` is false.
    return { ok: false, reason: owner.unavailableReason!, owner }
  }

  return { ok: true, owner }
}

// The explicit "fresh implementation" transition: a user action that abandons
// the current owner and establishes a new generation. Atomic against a
// concurrent resume of the old owner (see `start_fresh_implementation`). Errors
// with `not_found` if the issue is not the user's, or `validation` for a Spec.
export async function startFreshImplementation(
  supabase: Supabase,
  userId: string,
  issueId: string
): Promise<ImplementationOwner> {
  const { error } = await supabase
    .rpc("start_fresh_implementation", {
      p_user_id: userId,
      p_issue_id: issueId,
    })
    .single()

  if (error) {
    // P0002 = no_data_found (issue not owned / missing); 22023 = Spec.
    if (error.code === "P0002") {
      throw new ServiceError("not_found", "Issue not found")
    }
    if (error.code === "22023") {
      throw new ServiceError("validation", error.message)
    }
    throw new ServiceError("internal", error.message)
  }

  const owner = await resolveImplementationOwner(supabase, issueId)
  if (!owner) {
    throw new ServiceError(
      "internal",
      "Fresh implementation did not establish an owner"
    )
  }
  return owner
}
