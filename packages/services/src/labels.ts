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

export async function createLabel(
  supabase: Supabase,
  userId: string,
  input: CreateLabelValues
): Promise<LabelCatalogItem> {
  if ((await countActiveLabels(supabase, userId)) >= ACTIVE_LABEL_LIMIT) {
    throw new ServiceError("validation", "Active label limit reached.")
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

  return (await withAssignmentCounts(supabase, [data as LabelRow]))[0]
}

// Verifies every id refers to an active label owned by `userId` in one query
// — covers stale ids, cross-account ids, and archived labels alike. Callers
// that pass an empty array should skip this check themselves.
export async function ensureLabelsAssignable(
  supabase: Supabase,
  userId: string,
  labelIds: string[]
): Promise<void> {
  const rows = unwrap(
    await supabase
      .from("labels")
      .select("id")
      .in("id", labelIds)
      .eq("user_id", userId)
      .eq("state", "active")
      .returns<Array<{ id: string }>>()
  )

  if (rows.length !== labelIds.length) {
    throw new ServiceError("not_found", "Label not found.")
  }
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
