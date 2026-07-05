import {
  getAgentContext,
  handleAgentError,
  json,
  type Supabase,
} from "../../_lib"

export const runtime = "nodejs"

type ClaimedIssueRow = {
  id: string
  agent_provider: "claude_code" | "codex"
  session_id: string | null
  run_finished_at: string | null
  repo: string
  setup_script: string | null
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
  const { data: issue, error } = await supabase
    .rpc("claim_next_unblocked_issue", { p_user_id: userId })
    .maybeSingle<ClaimedIssueRow>()

  if (error) {
    throw new Error(error.message)
  }
  if (!issue) {
    return null
  }

  return {
    id: issue.id,
    agentProvider: issue.agent_provider,
    repo: issue.repo,
    setupScript: issue.setup_script,
    sessionId: issue.session_id,
    runFinishedAt: issue.run_finished_at,
  }
}
