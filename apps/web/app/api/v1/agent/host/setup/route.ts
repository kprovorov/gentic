import { updateHost } from "@gentic/services/hosts"
import { hostSetupStateSchema } from "@gentic/validators/hosts"
import { z } from "zod"

import { getAgentContext, handleAgentError, json } from "../../_lib"

export const runtime = "nodejs"

const setupSchema = z
  .object({
    setup_state: hostSetupStateSchema.extract(["ready", "setup_failed"]),
  })
  .strict()

export async function PATCH(request: Request) {
  try {
    const { supabase, userId, hostId } = await getAgentContext(request)
    const fields = setupSchema.parse(await request.json())
    const host = await updateHost(supabase, userId, hostId, {
      setup_state: fields.setup_state,
    })

    return json({
      host: {
        id: host.id,
        setup_state: host.setup_state,
      },
    })
  } catch (error) {
    return handleAgentError(error)
  }
}
