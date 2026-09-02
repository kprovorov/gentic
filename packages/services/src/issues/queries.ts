import { ServiceError, unwrap } from "../errors"
import { ensureLabelsAssignable } from "../labels"
import type { Supabase } from "../types"
import { ensureIssueOwned, ensureProjectOwned } from "./ownership"
import {
  ISSUE_WITH_PROJECT_AND_LABELS_SELECT,
  type IssuePullRequest,
  type IssueRelation,
  type IssueRelationIssue,
  withActiveAssignedLabels,
} from "./shared"

export type ListIssuesFilters = {
  projectId?: string
  labelIds?: string[]
  unlabeled?: boolean
}

async function validateLabelFilters(
  supabase: Supabase,
  userId: string,
  filters?: ListIssuesFilters
) {
  const labelIds = Array.from(new Set(filters?.labelIds ?? []))

  if (filters?.unlabeled && labelIds.length > 0) {
    throw new ServiceError(
      "validation",
      "No labels cannot be combined with specific Label filters."
    )
  }

  if (labelIds.length > 0) {
    try {
      await ensureLabelsAssignable(supabase, userId, labelIds)
    } catch (error) {
      if (error instanceof ServiceError && error.code === "not_found") {
        throw new ServiceError(
          "not_found",
          "One or more Label filter IDs are missing, archived, or not owned by this account."
        )
      }
      throw error
    }
  }

  return labelIds
}

export async function listIssues(
  supabase: Supabase,
  userId: string,
  filters?: ListIssuesFilters
) {
  if (filters?.projectId) {
    await ensureProjectOwned(supabase, userId, filters.projectId)
  }

  const labelIds = await validateLabelFilters(supabase, userId, filters)
  let query = supabase
    .from("issues")
    .select(ISSUE_WITH_PROJECT_AND_LABELS_SELECT)
    .eq("projects.user_id", userId)
    .order("created_at", { ascending: false })

  if (filters?.projectId) {
    query = query.eq("project_id", filters.projectId)
  }

  const issues = unwrap(await query).map((issue) =>
    withActiveAssignedLabels(issue)
  )

  return issues.filter((issue) => {
    const assignedIds = new Set(issue.labels.map((label) => label.id))
    if (filters?.unlabeled) return assignedIds.size === 0
    return labelIds.every((labelId) => assignedIds.has(labelId))
  })
}

export async function getIssue(supabase: Supabase, userId: string, id: string) {
  const { data, error } = await supabase
    .from("issues")
    .select(ISSUE_WITH_PROJECT_AND_LABELS_SELECT)
    .eq("id", id)
    .eq("projects.user_id", userId)
    .maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (!data) {
    throw new ServiceError("not_found", "Issue not found")
  }

  return withActiveAssignedLabels(data)
}

export async function getIssueByCode(
  supabase: Supabase,
  userId: string,
  projectKey: string,
  issueNumber: number
) {
  const { data, error } = await supabase
    .from("issues")
    .select(ISSUE_WITH_PROJECT_AND_LABELS_SELECT)
    .eq("number", issueNumber)
    .eq("projects.key", projectKey)
    .eq("projects.user_id", userId)
    .maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (!data) {
    throw new ServiceError("not_found", "Issue not found")
  }

  return withActiveAssignedLabels(data)
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
      .select("id,number,title,status,projects!inner(key,user_id)")
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
): Promise<IssueRelation[]> {
  await ensureIssueOwned(supabase, userId, issueId)

  const relations = unwrap(
    await supabase
      .from("issue_relations")
      .select(
        "id,source_issue_id,target_issue_id,type,created_at,source_issue:issues!issue_relations_source_issue_id_fkey(id,number,title,status,projects(key)),target_issue:issues!issue_relations_target_issue_id_fkey(id,number,title,status,projects(key))"
      )
      .or(`source_issue_id.eq.${issueId},target_issue_id.eq.${issueId}`)
      .order("created_at", { ascending: false })
  )

  return relations.map((relation) => ({
    ...relation,
    type: "blocks",
  }))
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
      .select("id,issue_id,url,created_at,state,head_sha,ci_state,review_decision")
      .eq("issue_id", issueId)
      .order("created_at", { ascending: false })
      .returns<IssuePullRequest[]>()
  )
}

export type IssuePullRequestMergeContext = {
  pullRequestId: string
  issueId: string
  repo: string
  prUrl: string
}

/**
 * Resolves a single pull request to the repository it lives in, so the merge
 * action (GEN-434) can address it on GitHub. `issue_pull_requests` stores only
 * the PR URL; the `owner/repo` slug lives on the owning project, two joins
 * away.
 *
 * Ownership goes through `ensureIssueOwned` rather than a filter on the
 * embedded project, so this authorizes exactly the way every other
 * issue-scoped read does — and so it holds if a caller ever reaches here with
 * the service client, which RLS does not constrain.
 */
export async function getIssuePullRequestMergeContext(
  supabase: Supabase,
  userId: string,
  pullRequestId: string
): Promise<IssuePullRequestMergeContext> {
  const { data, error } = await supabase
    .from("issue_pull_requests")
    .select("id,issue_id,url,issues!inner(projects!inner(repo))")
    .eq("id", pullRequestId)
    .maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (!data) {
    throw new ServiceError("not_found", "Pull request not found")
  }

  await ensureIssueOwned(supabase, userId, data.issue_id)

  return {
    pullRequestId: data.id,
    issueId: data.issue_id,
    repo: data.issues.projects.repo,
    prUrl: data.url,
  }
}

/**
 * The frozen Automatic Review policy for an Issue, or `null` before its first
 * pull request has been associated (nothing has been snapshotted yet).
 */
export async function getIssueReviewPolicy(
  supabase: Supabase,
  userId: string,
  issueId: string
) {
  await ensureIssueOwned(supabase, userId, issueId)

  const { data, error } = await supabase
    .from("issue_review_policies")
    .select("issue_id,enabled,reviewer_provider,reviewer_model,reviewer_instructions,created_at")
    .eq("issue_id", issueId)
    .maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }

  return data
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

export async function listBlockingIssueIds(
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
        "source_issue_id, target_issue:issues!issue_relations_target_issue_id_fkey(status)"
      )
      .in("source_issue_id", issueIds)
      .returns<
        { source_issue_id: string; target_issue: { status: string } }[]
      >()
  )

  const blockingIssueIds = new Set<string>()
  for (const relation of data) {
    if (
      relation.target_issue.status !== "completed" &&
      relation.target_issue.status !== "cancelled"
    ) {
      blockingIssueIds.add(relation.source_issue_id)
    }
  }

  return blockingIssueIds
}
