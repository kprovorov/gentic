import { claimHostSkillInstall } from "@gentic/services/skills"

import { getAgentContext, handleAgentError, json } from "../../_lib"

export const runtime = "nodejs"

/**
 * The host's outbound claim. A POST because claiming mutates: the command it
 * returns is marked accepted and is never handed out again, which is what makes
 * "attempt once, no automatic retry" hold across reconnects.
 */
export async function POST(request: Request) {
  try {
    const { supabase, hostId } = await getAgentContext(request)

    return json({ command: await claimHostSkillInstall(supabase, hostId) })
  } catch (error) {
    return handleAgentError(error)
  }
}
