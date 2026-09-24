import { claimHostToolUpdate } from "@gentic/services/host-tool-updates"

import { getAgentContext, handleAgentError, json } from "../../_lib"

export const runtime = "nodejs"

/**
 * The host's outbound claim, polled on the same control tick as skill
 * installs. A POST because claiming mutates: the command it returns is marked
 * accepted and is never handed out again, which is what makes "attempt once,
 * no automatic retry" hold across reconnects.
 */
export async function POST(request: Request) {
  try {
    const { supabase, hostId } = await getAgentContext(request)

    return json({ command: await claimHostToolUpdate(supabase, hostId) })
  } catch (error) {
    return handleAgentError(error)
  }
}
