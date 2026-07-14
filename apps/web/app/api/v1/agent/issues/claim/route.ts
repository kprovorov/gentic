import { getAgentContext, handleAgentError, json } from "../../_lib"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const { supabase, userId } = await getAgentContext(request)
    const { data, error } = await supabase
      .rpc("claim_issue_run", {
        p_user_id: userId,
      })

    if (error) {
      throw new Error(error.message)
    }

    const rows = data as ClaimedRunRow[] | null
    const claimed = rows?.[0]
    if (!claimed) {
      return json({ issue: null })
    }

    if (!claimed.repo) {
      throw new Error("Issue has no associated project repo")
    }

    return json({
      issue: {
        id: claimed.id,
        runId: claimed.run_id,
        agentProvider: claimed.agent_provider,
        repo: claimed.repo,
        setupScript: claimed.setup_script,
        sessionId: claimed.session_id,
        runFinishedAt: claimed.run_finished_at,
        prUrl: claimed.pr_url,
      },
    })
  } catch (error) {
    return handleAgentError(error)
  }
}

type ClaimedRunRow = {
  id: string
  run_id: string
  agent_provider: "claude_code" | "codex"
  session_id: string | null
  run_finished_at: string | null
  pr_url: string | null
  repo: string
  setup_script: string | null
}
