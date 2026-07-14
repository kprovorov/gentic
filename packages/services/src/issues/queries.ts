import { ServiceError, unwrap } from "../errors"
import type { Supabase } from "../types"
import { ensureIssueOwned, ensureProjectOwned } from "./ownership"
import {
  ISSUE_WITH_PROJECT_SELECT,
  type IssuePullRequest,
  type IssueRelation,
  type IssueRelationIssue,
} from "./shared"

export async function listIssues(
  supabase: Supabase,
  userId: string,
  filters?: { projectId?: string }
) {
  if (filters?.projectId) {
    await ensureProjectOwned(supabase, userId, filters.projectId)
  }

  let query = supabase
    .from("issues")
    .select(ISSUE_WITH_PROJECT_SELECT)
    .eq("projects.user_id", userId)
    .order("created_at", { ascending: false })

  if (filters?.projectId) {
    query = query.eq("project_id", filters.projectId)
  }

  return unwrap(await query)
}

export async function getIssue(supabase: Supabase, userId: string, id: string) {
  const { data, error } = await supabase
    .from("issues")
    .select(ISSUE_WITH_PROJECT_SELECT)
    .eq("id", id)
    .eq("projects.user_id", userId)
    .maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (!data) {
    throw new ServiceError("not_found", "Issue not found")
  }

  return data
}

export async function listIssueRelationCandidates(
  supabase: Supabase,
  userId: string,
  issueId: string
) {
  await ensureIssueOwned(supabase, userId, issueId)

  return unwrap(
    await supabase
      .from("issues")
      .select("id,title,status,projects!inner(user_id)")
      .eq("projects.user_id", userId)
      .neq("id", issueId)
      .order("created_at", { ascending: false })
      .returns<IssueRelationIssue[]>()
  )
}

export async function listIssueRelations(
  supabase: Supabase,
  userId: string,
  issueId: string
) {
  await ensureIssueOwned(supabase, userId, issueId)

  return unwrap(
    await supabase
      .from("issue_relations")
      .select(
        "id,source_issue_id,target_issue_id,type,created_at,source_issue:issues!issue_relations_source_issue_id_fkey(id,title,status),target_issue:issues!issue_relations_target_issue_id_fkey(id,title,status)"
      )
      .or(`source_issue_id.eq.${issueId},target_issue_id.eq.${issueId}`)
      .order("created_at", { ascending: false })
      .returns<IssueRelation[]>()
  )
}

export async function listIssuePullRequests(
  supabase: Supabase,
  userId: string,
  issueId: string
) {
  await ensureIssueOwned(supabase, userId, issueId)

  return unwrap(
    await supabase
      .from("issue_pull_requests")
      .select("id,issue_id,url,created_at")
      .eq("issue_id", issueId)
      .order("created_at", { ascending: false })
      .returns<IssuePullRequest[]>()
  )
}

export async function listBlockedIssueIds(
  supabase: Supabase,
  issueIds: string[]
) {
  if (issueIds.length === 0) {
    return new Set<string>()
  }

  const data = unwrap(
    await supabase
      .from("issue_relations")
      .select(
        "target_issue_id, source_issue:issues!issue_relations_source_issue_id_fkey(status)"
      )
      .in("target_issue_id", issueIds)
      .returns<
        { target_issue_id: string; source_issue: { status: string } }[]
      >()
  )

  const blockedIssueIds = new Set<string>()
  for (const relation of data) {
    if (
      relation.source_issue.status !== "completed" &&
      relation.source_issue.status !== "cancelled"
    ) {
      blockedIssueIds.add(relation.target_issue_id)
    }
  }

  return blockedIssueIds
}
