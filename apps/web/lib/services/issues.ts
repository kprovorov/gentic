import type {
  CreateIssueValues,
  IssueStatus,
  UpdateIssueValues,
} from "@gentic/validators/issues"

import { ServiceError } from "./errors"
import type { Supabase } from "./types"

const ISSUE_WITH_PROJECT_SELECT = "*, projects!inner(id,name,repo,user_id)"

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
