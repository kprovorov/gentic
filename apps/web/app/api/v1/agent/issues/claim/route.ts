import {
  getAgentContext,
  handleAgentError,
  json,
  type Supabase,
} from "../../_lib"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const { supabase, userId } = await getAgentContext(request)
    return json({ issue: await claimNextQueuedIssue(supabase, userId) })
  } catch (error) {
    return handleAgentError(error)
  }
}

async function claimNextQueuedIssue(supabase: Supabase, userId: string) {
  const { data: candidate, error: candidateError } = await supabase
    .from("issues")
    .select("id, session_id, run_finished_at, projects!inner(repo,user_id)")
    .eq("run_status", "queued")
    .eq("projects.user_id", userId)
    .order("updated_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (candidateError) {
    throw new Error(candidateError.message)
  }
  if (!candidate) {
    return null
  }

  const id = (candidate as { id: string }).id
  const now = new Date().toISOString()
  const { data: claimed, error: claimError } = await supabase
    .from("issues")
    .update({
      run_status: "cloning",
      run_started_at: now,
      run_error: null,
      run_finished_at: null,
      updated_at: now,
    })
    .eq("id", id)
    .eq("run_status", "queued")
    .select("id")
    .maybeSingle()

  if (claimError) {
    throw new Error(claimError.message)
  }
  if (!claimed) {
    return null
  }

  return {
    id,
    repo: extractRepo(candidate),
    sessionId: (candidate as { session_id: string | null }).session_id,
    runFinishedAt: (candidate as { run_finished_at: string | null })
      .run_finished_at,
  }
}

function extractRepo(row: unknown): string {
  const projects = (row as { projects?: unknown }).projects
  const project = Array.isArray(projects) ? projects[0] : projects
  const repo = (project as { repo?: string } | undefined)?.repo
  if (!repo) {
    throw new Error("Issue has no associated project repo")
  }
  return repo
}
