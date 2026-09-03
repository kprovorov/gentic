import { getHostControlState } from "@gentic/services/hosts"

import { getAgentContextWithOptions, handleAgentError, json } from "../../_lib"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const { supabase, hostId, banned } = await getAgentContextWithOptions(
      request,
      { allowBanned: true }
    )

    return json(await getHostControlState(supabase, hostId, banned))
  } catch (error) {
    return handleAgentError(error)
  }
}
