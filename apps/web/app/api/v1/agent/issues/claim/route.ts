import {
  getAgentContext,
  handleAgentError,
  json,
  type Supabase,
} from "../../_lib"

export const runtime = "nodejs"

const CLAIM_ISSUE_SELECT =
  "id, agent_provider, session_id, run_finished_at, projects!inner(repo,setup_script,user_id), unfinished_blockers:issue_relations!issue_relations_target_issue_id_fkey(source_issue:issues!issue_relations_source_issue_id_fkey!inner(status))"

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
    .select(CLAIM_ISSUE_SELECT)
    .eq("run_status", "queued")
    .eq("projects.user_id", userId)
    .eq("unfinished_blockers.type", "blocks")
    .not("unfinished_blockers.source_issue.status", "in", "(completed,cancelled)")
    .is("unfinished_blockers", null)
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
      status: "in-progress",
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

  const project = extractProject(candidate)

  return {
    id,
    agentProvider:
      (candidate as { agent_provider: "claude_code" | "codex" }).agent_provider,
    repo: project.repo,
    setupScript: project.setup_script,
    sessionId: (candidate as { session_id: string | null }).session_id,
    runFinishedAt: (candidate as { run_finished_at: string | null })
      .run_finished_at,
  }
}

function extractProject(row: unknown): {
  repo: string
  setup_script: string | null
} {
  const projects = (row as { projects?: unknown }).projects
  const project = Array.isArray(projects) ? projects[0] : projects
  const repo = (project as { repo?: string } | undefined)?.repo
  if (!repo) {
    throw new Error("Issue has no associated project repo")
  }
  const setup_script =
    (project as { setup_script?: string | null } | undefined)?.setup_script ??
    null
  return { repo, setup_script }
}
