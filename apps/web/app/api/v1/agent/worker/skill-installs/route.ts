import { claimWorkerSkillInstall } from "@gentic/services/skills"

import { getAgentContext, handleAgentError, json } from "../../_lib"

export const runtime = "nodejs"

/**
 * The worker's outbound claim. A POST because claiming mutates: the command it
 * returns is marked accepted and is never handed out again, which is what makes
 * "attempt once, no automatic retry" hold across reconnects.
 */
export async function POST(request: Request) {
  try {
    const { supabase, workerId } = await getAgentContext(request)

    return json({ command: await claimWorkerSkillInstall(supabase, workerId) })
  } catch (error) {
    return handleAgentError(error)
  }
}
