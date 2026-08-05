import { ensureLabelsAssignable, type LabelSnapshot } from "../labels"
import { ServiceError, unwrap } from "../errors"
import type { Supabase } from "../types"
import { ensureIssuesOwned } from "./ownership"

const MAX_LABELS_PER_ISSUE = 20

type IssueLabelRow = { issue_id: string; label_id: string }

function groupByIssue(rows: IssueLabelRow[]): Map<string, Set<string>> {
  const grouped = new Map<string, Set<string>>()
  for (const row of rows) {
    const labelIds = grouped.get(row.issue_id) ?? new Set<string>()
    labelIds.add(row.label_id)
    grouped.set(row.issue_id, labelIds)
  }
  return grouped
}

export async function addIssueLabels(
  supabase: Supabase,
  userId: string,
  issueIds: string[],
  labelIds: string[]
): Promise<void> {
  await ensureIssuesOwned(supabase, userId, issueIds)
  const snapshots = await ensureLabelsAssignable(supabase, userId, labelIds)
  const labelById = new Map(snapshots.map((label) => [label.id, label]))

  const existingRows = unwrap(
    await supabase
      .from("issue_labels")
      .select("issue_id,label_id")
      .in("issue_id", issueIds)
      .returns<IssueLabelRow[]>()
  )
  const assignedByIssue = groupByIssue(existingRows)

  const newLabelIdsByIssue = new Map<string, string[]>()
  const issuesOverLimit: string[] = []
  for (const issueId of issueIds) {
    const alreadyAssigned = assignedByIssue.get(issueId) ?? new Set<string>()
    const newLabelIds = labelIds.filter((id) => !alreadyAssigned.has(id))
    if (newLabelIds.length === 0) continue
    if (alreadyAssigned.size + newLabelIds.length > MAX_LABELS_PER_ISSUE) {
      issuesOverLimit.push(issueId)
      continue
    }
    newLabelIdsByIssue.set(issueId, newLabelIds)
  }

  if (issuesOverLimit.length > 0) {
    throw new ServiceError(
      "validation",
      `Adding these labels would exceed the ${MAX_LABELS_PER_ISSUE}-label limit for issue(s): ${issuesOverLimit.join(", ")}.`
    )
  }

  if (newLabelIdsByIssue.size === 0) {
    return
  }

  const rowsToInsert = Array.from(newLabelIdsByIssue.entries()).flatMap(
    ([issueId, newLabelIds]) =>
      newLabelIds.map((labelId) => ({ issue_id: issueId, label_id: labelId }))
  )
  unwrap(await supabase.from("issue_labels").insert(rowsToInsert))

  const eventsToInsert = Array.from(newLabelIdsByIssue.entries()).map(
    ([issueId, newLabelIds]) => ({
      issue_id: issueId,
      type: "labels_changed",
      payload: {
        added: newLabelIds.map((id) => labelById.get(id)!),
        removed: [] as LabelSnapshot[],
      },
    })
  )
  unwrap(await supabase.from("issue_events").insert(eventsToInsert))
}

export async function removeIssueLabels(
  supabase: Supabase,
  userId: string,
  issueIds: string[],
  labelIds: string[]
): Promise<void> {
  await ensureIssuesOwned(supabase, userId, issueIds)
  const snapshots = await ensureLabelsAssignable(supabase, userId, labelIds)
  const labelById = new Map(snapshots.map((label) => [label.id, label]))

  const existingRows = unwrap(
    await supabase
      .from("issue_labels")
      .select("issue_id,label_id")
      .in("issue_id", issueIds)
      .in("label_id", labelIds)
      .returns<IssueLabelRow[]>()
  )

  if (existingRows.length === 0) {
    return
  }

  const removedByIssue = groupByIssue(existingRows)

  unwrap(
    await supabase
      .from("issue_labels")
      .delete()
      .in("issue_id", issueIds)
      .in("label_id", labelIds)
  )

  const eventsToInsert = Array.from(removedByIssue.entries()).map(
    ([issueId, removedLabelIds]) => ({
      issue_id: issueId,
      type: "labels_changed",
      payload: {
        added: [] as LabelSnapshot[],
        removed: Array.from(removedLabelIds).map((id) => labelById.get(id)!),
      },
    })
  )
  unwrap(await supabase.from("issue_events").insert(eventsToInsert))
}
