import {
  labelPresetColors,
  type CreateLabelValues,
  type LabelColor,
  type UpdateLabelValues,
} from "@gentic/validators/labels"

import { ServiceError, unwrap } from "./errors"
import type { Supabase } from "./types"

export type LabelCatalogItem = {
  id: string
  name: string
  color: string
  state: "active"
  created_at: string
  updated_at: string
  assignment_count: number
}

type LabelRow = {
  id: string
  name: string
  color: string
  state: "active" | "archived"
  created_at: string
  updated_at: string
}

const ACTIVE_LABEL_LIMIT = 100

function isUniqueViolation(error: { code?: string } | null | undefined) {
  return error?.code === "23505"
}

function mapLabelError(error: { code?: string; message: string }) {
  if (isUniqueViolation(error)) {
    return new ServiceError("validation", "Label name already exists.")
  }
  // The `enforce_active_label_limit` trigger raises a check violation when an
  // insert or restore would push the account past the 100-active cap; the
  // service pre-checks the count for a friendly error, so this only fires
  // under a race, but map it so the atomic failure still reads as validation.
  if (error.code === "23514") {
    return new ServiceError("validation", "Active label limit reached.")
  }
  return new ServiceError("internal", error.message)
}

function toAssignmentCounts(rows: Array<{ label_id: string }>) {
  const counts = new Map<string, number>()
  for (const row of rows) {
    counts.set(row.label_id, (counts.get(row.label_id) ?? 0) + 1)
  }
  return counts
}

async function countActiveLabels(supabase: Supabase, userId: string) {
  const { count, error } = await supabase
    .from("labels")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("state", "active")

  if (error) {
    throw new ServiceError("internal", error.message)
  }

  return count ?? 0
}

async function chooseLeastUsedPresetColor(
  supabase: Supabase,
  userId: string
): Promise<LabelColor> {
  const labels = unwrap(
    await supabase
      .from("labels")
      .select("color")
      .eq("user_id", userId)
      .eq("state", "active")
  )

  const presetCounts = new Map<LabelColor, number>(
    labelPresetColors.map((color) => [color, 0])
  )

  for (const label of labels) {
    if (presetCounts.has(label.color as LabelColor)) {
      presetCounts.set(
        label.color as LabelColor,
        (presetCounts.get(label.color as LabelColor) ?? 0) + 1
      )
    }
  }

  const leastUsedCount = Math.min(...presetCounts.values())
  const candidates = labelPresetColors.filter(
    (color) => presetCounts.get(color) === leastUsedCount
  )

  return candidates[Math.floor(Math.random() * candidates.length)]
}

async function withAssignmentCounts(
  supabase: Supabase,
  labels: LabelRow[]
): Promise<LabelCatalogItem[]> {
  if (labels.length === 0) {
    return []
  }

  const labelIds = labels.map((label) => label.id)
  const assignmentRows = unwrap(
    await supabase
      .from("issue_labels")
      .select("label_id")
      .in("label_id", labelIds)
      .returns<Array<{ label_id: string }>>()
  )
  const counts = toAssignmentCounts(assignmentRows)

  return labels.map((label) => ({
    id: label.id,
    name: label.name,
    color: label.color,
    state: "active",
    created_at: label.created_at,
    updated_at: label.updated_at,
    assignment_count: counts.get(label.id) ?? 0,
  }))
}

export async function listLabels(
  supabase: Supabase,
  userId: string,
  filters?: { search?: string }
): Promise<LabelCatalogItem[]> {
  const labels = unwrap(
    await supabase
      .from("labels")
      .select("id,name,color,state,created_at,updated_at")
      .eq("user_id", userId)
      .eq("state", "active")
      .returns<LabelRow[]>()
  )

  const search = filters?.search?.trim().toLocaleLowerCase()
  const filteredLabels = search
    ? labels.filter((label) => label.name.toLocaleLowerCase().includes(search))
    : labels

  const sortedLabels = filteredLabels.toSorted((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  )

  return withAssignmentCounts(supabase, sortedLabels)
}

export type CreateLabelResult = {
  label: LabelCatalogItem
  // True when an archived Label of the same name was revived instead of a new
  // row being inserted (see the create-or-restore contract below).
  restored: boolean
}

// Finds the single Label (active or archived) whose case-insensitive name
// matches, using the `name_key = lower(name)` generated column — the same key
// the `(user_id, name_key)` unique constraint enforces, so at most one row can
// match per account.
async function findLabelByName(
  supabase: Supabase,
  userId: string,
  name: string
): Promise<{ id: string; state: "active" | "archived" } | null> {
  const rows = unwrap(
    await supabase
      .from("labels")
      .select("id,state")
      .eq("user_id", userId)
      .eq("name_key", name.toLowerCase())
      .returns<Array<{ id: string; state: "active" | "archived" }>>()
  )

  return rows[0] ?? null
}

// Revives an archived Label in place: flips it back to active and clears
// `archived_at` while leaving its id, display name, and color untouched, so the
// original identity returns without the caller's supplied casing/color
// overwriting it. Former issue assignments are intentionally not restored — the
// `issue_labels` rows were deleted at archive time and stay gone. The single
// UPDATE is atomic and fires `enforce_active_label_limit`, so a full active
// catalog rejects the restore without leaving the row half-changed.
async function restoreArchivedLabel(
  supabase: Supabase,
  userId: string,
  id: string
): Promise<LabelCatalogItem> {
  const { data, error } = await supabase
    .from("labels")
    .update({
      state: "active",
      archived_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("state", "archived")
    .select("id,name,color,state,created_at,updated_at")
    .maybeSingle()

  if (error) {
    throw mapLabelError(error)
  }
  if (!data) {
    throw new ServiceError("not_found", "Label not found.")
  }

  return (await withAssignmentCounts(supabase, [data as LabelRow]))[0]
}

// Creates a Label, or — when an archived Label already reserves the exact
// trimmed, case-insensitive name — restores that Label instead of inserting a
// duplicate (the `(user_id, name_key)` unique constraint spans both states, so
// a plain insert would otherwise collide). A collision with an *active* name is
// still rejected. Both paths obey the 100-active-Label limit.
export async function createLabel(
  supabase: Supabase,
  userId: string,
  input: CreateLabelValues
): Promise<CreateLabelResult> {
  const existing = await findLabelByName(supabase, userId, input.name)

  if (existing?.state === "active") {
    throw new ServiceError("validation", "Label name already exists.")
  }

  if ((await countActiveLabels(supabase, userId)) >= ACTIVE_LABEL_LIMIT) {
    throw new ServiceError("validation", "Active label limit reached.")
  }

  if (existing) {
    const label = await restoreArchivedLabel(supabase, userId, existing.id)
    return { label, restored: true }
  }

  const color =
    input.color ?? (await chooseLeastUsedPresetColor(supabase, userId))
  const { data, error } = await supabase
    .from("labels")
    .insert({
      user_id: userId,
      name: input.name,
      color,
    })
    .select("id,name,color,state,created_at,updated_at")
    .single()

  if (error) {
    throw mapLabelError(error)
  }

  const label = (await withAssignmentCounts(supabase, [data as LabelRow]))[0]
  return { label, restored: false }
}

export type LabelSnapshot = { id: string; name: string; color: string }

// Verifies every id refers to an active label owned by `userId` in one query
// — covers stale ids, cross-account ids, and archived labels alike. Callers
// that pass an empty array should skip this check themselves. Returns the
// matched labels' name/color so callers can build event snapshots without a
// second query.
export async function ensureLabelsAssignable(
  supabase: Supabase,
  userId: string,
  labelIds: string[]
): Promise<LabelSnapshot[]> {
  const rows = unwrap(
    await supabase
      .from("labels")
      .select("id,name,color")
      .in("id", labelIds)
      .eq("user_id", userId)
      .eq("state", "active")
      .returns<LabelSnapshot[]>()
  )

  if (rows.length !== labelIds.length) {
    throw new ServiceError("not_found", "Label not found.")
  }

  return rows
}

export async function updateLabel(
  supabase: Supabase,
  userId: string,
  input: UpdateLabelValues
): Promise<LabelCatalogItem> {
  const patch = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.color !== undefined ? { color: input.color } : {}),
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase
    .from("labels")
    .update(patch)
    .eq("id", input.id)
    .eq("user_id", userId)
    .eq("state", "active")
    .select("id,name,color,state,created_at,updated_at")
    .maybeSingle()

  if (error) {
    throw mapLabelError(error)
  }
  if (!data) {
    throw new ServiceError("not_found", "Label not found.")
  }

  return (await withAssignmentCounts(supabase, [data as LabelRow]))[0]
}

export type ArchiveLabelResult = {
  archived: true
  affected_issue_count: number
}

// Atomically marks the label archived, removes every assignment (any
// count, including zero), and records one grouped removal event per
// affected issue — all inside the `archive_label` SECURITY DEFINER RPC
// (20260805130000_add_archive_label_rpc.sql), so a failure partway through
// leaves no state changed. That RPC enforces ownership itself via
// `p_user_id` and is granted to `service_role` only (like the worker
// lifecycle RPCs), so callers must pass a service-role `Supabase` client.
// Archival has no dedicated restore action; instead, `createLabel` revives an
// archived label when a new label reuses its exact name — the former issue
// assignments stripped here stay gone.
export async function archiveLabel(
  supabase: Supabase,
  userId: string,
  id: string
): Promise<ArchiveLabelResult> {
  const { data, error } = await supabase
    .rpc("archive_label", {
      p_user_id: userId,
      p_label_id: id,
    })
    .maybeSingle()
    .returns<{ id: string; affected_issue_count: number } | null>()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (!data) {
    throw new ServiceError("not_found", "Label not found.")
  }

  return { archived: true, affected_issue_count: data.affected_issue_count }
}

// Narrows a set of label ids (typically referenced by historical
// `labels_changed` event snapshots) down to the ones that are currently
// archived, so historical timeline entries can still render the label's
// name/color while indicating it's no longer part of the active catalog.
export async function listArchivedLabelIds(
  supabase: Supabase,
  userId: string,
  labelIds: string[]
): Promise<Set<string>> {
  if (labelIds.length === 0) {
    return new Set()
  }

  const rows = unwrap(
    await supabase
      .from("labels")
      .select("id")
      .eq("user_id", userId)
      .in("id", labelIds)
      .eq("state", "archived")
      .returns<Array<{ id: string }>>()
  )

  return new Set(rows.map((row) => row.id))
}
