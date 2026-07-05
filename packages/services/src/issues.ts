import type {
  CreateIssueValues,
  IssueRelationDirection,
  IssueStatus,
  UpdateIssueValues,
} from "@gentic/validators/issues"

import { ServiceError } from "./errors"
import type { Supabase } from "./types"

const ISSUE_WITH_PROJECT_SELECT = "*, projects!inner(id,name,repo,user_id)"

export type IssueRelationIssue = {
  id: string
  title: string
  status: string
}

export type IssueRelation = {
  id: string
  source_issue_id: string
  target_issue_id: string
  type: "blocks"
  created_at: string
  source_issue: IssueRelationIssue
  target_issue: IssueRelationIssue
}

async function ensureProjectOwned(
  supabase: Supabase,
  userId: string,
  projectId: string
) {
  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (!data) {
    throw new ServiceError("not_found", "Project not found")
  }
}

// The `issues` table has no `user_id` of its own, so ownership is checked via
// a join to `projects`, whose `user_id` column does carry the Clerk user id.
async function ensureIssueOwned(supabase: Supabase, userId: string, issueId: string) {
  const { data, error } = await supabase
    .from("issues")
    .select("id, projects!inner(user_id)")
    .eq("id", issueId)
    .eq("projects.user_id", userId)
    .maybeSingle()

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if (!data) {
    throw new ServiceError("not_found", "Issue not found")
  }
}

async function ensureIssuesOwned(
  supabase: Supabase,
  userId: string,
  issueIds: string[]
) {
  const uniqueIds = Array.from(new Set(issueIds))
  const { data, error } = await supabase
    .from("issues")
    .select("id, projects!inner(user_id)")
    .in("id", uniqueIds)
    .eq("projects.user_id", userId)

  if (error) {
    throw new ServiceError("internal", error.message)
  }
  if ((data?.length ?? 0) !== uniqueIds.length) {
    throw new ServiceError("not_found", "Issue not found")
  }
}

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

  const { data, error } = await query

  if (error) {
    throw new ServiceError("internal", error.message)
  }

  return data
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

  const { data, error } = await supabase
    .from("issues")
    .select("id,title,status,projects!inner(user_id)")
    .eq("projects.user_id", userId)
    .neq("id", issueId)
    .order("created_at", { ascending: false })
    .returns<IssueRelationIssue[]>()

  if (error) {
    throw new ServiceError("internal", error.message)
  }

  return data
}

export async function listIssueRelations(
  supabase: Supabase,
  userId: string,
  issueId: string
) {
  await ensureIssueOwned(supabase, userId, issueId)

  const { data, error } = await supabase
    .from("issue_relations")
    .select(
      "id,source_issue_id,target_issue_id,type,created_at,source_issue:issues!issue_relations_source_issue_id_fkey(id,title,status),target_issue:issues!issue_relations_target_issue_id_fkey(id,title,status)"
    )
    .or(`source_issue_id.eq.${issueId},target_issue_id.eq.${issueId}`)
    .order("created_at", { ascending: false })
    .returns<IssueRelation[]>()

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

  const { data, error } = await supabase
    .from("issue_relations")
    .select(
      "target_issue_id, source_issue:issues!issue_relations_source_issue_id_fkey(status)"
    )
    .in("target_issue_id", issueIds)
    .returns<{ target_issue_id: string; source_issue: { status: string } }[]>()

  if (error) {
    throw new ServiceError("internal", error.message)
  }

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

export async function createIssue(
  supabase: Supabase,
  userId: string,
  input: CreateIssueValues
) {
  await ensureProjectOwned(supabase, userId, input.project_id)

  const { data, error } = await supabase
    .from("issues")
    .insert({
      project_id: input.project_id,
      title: input.title,
      prompt: input.prompt ?? null,
      status: input.status,
      agent_provider: input.agent_provider,
    })
    .select("id")
    .single()

  if (error) {
    throw new ServiceError("internal", error.message)
  }

  return data
}

export async function updateIssue(
  supabase: Supabase,
  userId: string,
  id: string,
  input: UpdateIssueValues
) {
  await ensureIssueOwned(supabase, userId, id)

  const { data: current, error: fetchError } = await supabase
    .from("issues")
    .select("agent_provider")
    .eq("id", id)
    .single<{ agent_provider: string }>()

  if (fetchError) {
    throw new ServiceError("internal", fetchError.message)
  }

  const { error } = await supabase
    .from("issues")
    .update({
      title: input.title,
      prompt: input.prompt ?? null,
      agent_provider: input.agent_provider,
      ...(current.agent_provider !== input.agent_provider
        ? { session_id: null }
        : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)

  if (error) {
    throw new ServiceError("internal", error.message)
  }
}

export async function deleteIssue(supabase: Supabase, userId: string, id: string) {
  await ensureIssueOwned(supabase, userId, id)

  const { error } = await supabase.from("issues").delete().eq("id", id)

  if (error) {
    throw new ServiceError("internal", error.message)
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

  const sourceIssueId = direction === "blocking" ? issueId : relatedIssueId
  const targetIssueId = direction === "blocking" ? relatedIssueId : issueId

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

  const { error } = await supabase
    .from("issue_relations")
    .delete()
    .eq("id", relationId)

  if (error) {
    throw new ServiceError("internal", error.message)
  }
}

export async function updateIssueStatus(
  supabase: Supabase,
  userId: string,
  id: string,
  status: IssueStatus
) {
  await ensureIssueOwned(supabase, userId, id)

  const { data: current, error: fetchError } = await supabase
    .from("issues")
    .select("status,title,prompt")
    .eq("id", id)
    .single<{ status: string; title: string; prompt: string | null }>()

  if (fetchError) {
    throw new ServiceError("internal", fetchError.message)
  }

  // Moving an issue from Draft to Todo queues an agent run: the remote
  // `@gentic/gentic` agent picks up `run_status = 'queued'` issues over
  // Supabase and drives the issue's selected coding agent against a fresh clone.
  const startsRun = current.status === "draft" && status === "todo"

  const { error } = await supabase
    .from("issues")
    .update(startsRun ? { status, run_status: "queued" } : { status })
    .eq("id", id)

  if (error) {
    throw new ServiceError("internal", error.message)
  }

  if (startsRun) {
    const messageContent = current.prompt
      ? `${current.title}\n\n${current.prompt}`
      : current.title

    const { error: messageError } = await supabase.from("messages").insert({
      issue_id: id,
      role: "user",
      content: messageContent,
    })

    if (messageError) {
      throw new ServiceError("internal", messageError.message)
    }
  }
}

export async function sendIssueMessage(
  supabase: Supabase,
  userId: string,
  issueId: string,
  content: string
) {
  await ensureIssueOwned(supabase, userId, issueId)

  const { error } = await supabase.from("messages").insert({
    issue_id: issueId,
    role: "user",
    content,
  })

  if (error) {
    throw new ServiceError("internal", error.message)
  }

  // A finished run has no worker polling for it anymore. Re-queue so the
  // `@gentic/gentic` agent picks this follow-up up and resumes the session.
  const { error: requeueError } = await supabase
    .from("issues")
    .update({ run_status: "queued", updated_at: new Date().toISOString() })
    .eq("id", issueId)
    .in("run_status", ["completed", "failed", "cancelled"])

  if (requeueError) {
    throw new ServiceError("internal", requeueError.message)
  }
}
