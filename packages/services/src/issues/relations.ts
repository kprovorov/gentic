import type { IssueRelationDirection } from "@gentic/validators/issues"

import { ServiceError, unwrap } from "../errors"
import type { Supabase } from "../types"
import { ensureIssueOwned, ensureIssuesOwned } from "./ownership"

export function relationEndpoints(
  issueId: string,
  relatedIssueId: string,
  direction: IssueRelationDirection
) {
  return {
    sourceIssueId: direction === "blocking" ? issueId : relatedIssueId,
    targetIssueId: direction === "blocking" ? relatedIssueId : issueId,
  }
}

export async function addIssueRelation(
  supabase: Supabase,
  userId: string,
  issueId: string,
  relatedIssueId: string,
  direction: IssueRelationDirection
) {
  if (issueId === relatedIssueId) {
    throw new ServiceError("validation", "An issue cannot relate to itself")
  }

  await ensureIssuesOwned(supabase, userId, [issueId, relatedIssueId])

  const { sourceIssueId, targetIssueId } = relationEndpoints(
    issueId,
    relatedIssueId,
    direction
  )

  const { error } = await supabase.from("issue_relations").insert({
    source_issue_id: sourceIssueId,
    target_issue_id: targetIssueId,
    type: "blocks",
  })

  if (error) {
    if (error.code === "23505") {
      throw new ServiceError("validation", "This relation already exists")
    }
    throw new ServiceError("internal", error.message)
  }
}

export async function deleteIssueRelation(
  supabase: Supabase,
  userId: string,
  relationId: string,
  issueId: string
) {
  await ensureIssueOwned(supabase, userId, issueId)

  const { data: relation, error: fetchError } = await supabase
    .from("issue_relations")
    .select("id,source_issue_id,target_issue_id")
    .eq("id", relationId)
    .or(`source_issue_id.eq.${issueId},target_issue_id.eq.${issueId}`)
    .maybeSingle<{
      id: string
      source_issue_id: string
      target_issue_id: string
    }>()

  if (fetchError) {
    throw new ServiceError("internal", fetchError.message)
  }
  if (!relation) {
    throw new ServiceError("not_found", "Relation not found")
  }

  await ensureIssuesOwned(supabase, userId, [
    relation.source_issue_id,
    relation.target_issue_id,
  ])

  unwrap(await supabase.from("issue_relations").delete().eq("id", relationId))
}
