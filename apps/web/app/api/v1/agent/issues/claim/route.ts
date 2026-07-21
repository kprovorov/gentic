import { getAgentContext, handleAgentError, json } from "../../_lib"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const { supabase, userId } = await getAgentContext(request)
    const { data, error } = await supabase
      .rpc("claim_issue_run", { p_user_id: userId })
      .maybeSingle()

    if (error) {
      throw new Error(error.message)
    }

    return json({
      issue: data
        ? {
            id: data.id,
            activeRunId: data.active_run_id,
            agentProvider: data.agent_provider,
            repo: data.repo,
            setupScript: data.setup_script,
            sessionId: data.session_id,
            prUrl: data.pr_url,
          }
        : null,
    })
  } catch (error) {
    return handleAgentError(error)
  }
}
