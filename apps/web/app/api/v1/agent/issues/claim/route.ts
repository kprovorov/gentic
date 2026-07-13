import {
  getAgentContext,
  handleAgentError,
  json,
  type Supabase,
} from "../../_lib"

export const runtime = "nodejs"

const CLAIM_ISSUE_SELECT =
  "id, agent_provider, session_id, run_finished_at, pr_url, projects!inner(repo,setup_script,user_id), unfinished_blockers:issue_relations!issue_relations_target_issue_id_fkey(source_issue:issues!issue_relations_source_issue_id_fkey!inner(status))"

type ClaimCandidateRow = {
  id: string
  agent_provider: "claude_code" | "codex"
  session_id: string | null
  run_finished_at: string | null
  pr_url: string | null
  projects: {
    repo: string
    setup_script: string | null
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, userId } = await getAgentContext(request)
    return json({ issue: await claimNextQueuedIssue(supabase, userId) })
  } catch (error) {
    return handleAgentError(error)
  }
}

async function claimNextQueuedIssue(supabase: Supabase, userId: string) {
  const now = new Date().toISOString()
  const { data: candidate, error: candidateError } = await supabase
    .from("issues")
    .select(CLAIM_ISSUE_SELECT)
    .or(`status.eq.todo,and(status.eq.held,usage_limit_reset_at.lte.${now})`)
    .eq("projects.user_id", userId)
    .eq("unfinished_blockers.type", "blocks")
    .not(
      "unfinished_blockers.source_issue.status",
      "in",
      "(completed,cancelled)"
    )
    .is("unfinished_blockers", null)
    .order("updated_at", { ascending: true })
    .limit(1)
    .maybeSingle()
    .returns<ClaimCandidateRow | null>()

  if (candidateError) {
    throw new Error(candidateError.message)
  }
  if (!candidate) {
    return null
  }

  const { id } = candidate
  const { data: claimed, error: claimError } = await supabase
    .from("issues")
    .update({
      status: "queued",
      run_started_at: now,
      run_error: null,
      run_finished_at: null,
      usage_limit_reset_at: null,
      updated_at: now,
    })
    .eq("id", id)
    .in("status", ["todo", "held"])
    .select("id")
    .maybeSingle()

  if (claimError) {
    throw new Error(claimError.message)
  }
  if (!claimed) {
    return null
  }

  if (!candidate.projects.repo) {
    throw new Error("Issue has no associated project repo")
  }

  return {
    id,
    agentProvider: candidate.agent_provider,
    repo: candidate.projects.repo,
    setupScript: candidate.projects.setup_script,
    sessionId: candidate.session_id,
    runFinishedAt: candidate.run_finished_at,
    prUrl: candidate.pr_url,
  }
}
