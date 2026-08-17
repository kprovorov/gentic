import { getWorkerControlState } from "@gentic/services/workers"

import { getAgentContextWithOptions, handleAgentError, json } from "../../_lib"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const { supabase, workerId, banned } = await getAgentContextWithOptions(
      request,
      { allowBanned: true }
    )

    return json(await getWorkerControlState(supabase, workerId, banned))
  } catch (error) {
    return handleAgentError(error)
  }
}
