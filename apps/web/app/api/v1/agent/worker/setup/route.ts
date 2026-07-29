import { updateWorker } from "@gentic/services/workers"
import { workerSetupStateSchema } from "@gentic/validators/workers"
import { z } from "zod"

import { getAgentContext, handleAgentError, json } from "../../_lib"

export const runtime = "nodejs"

const setupSchema = z
  .object({
    setup_state: workerSetupStateSchema.extract(["ready", "setup_failed"]),
  })
  .strict()

export async function PATCH(request: Request) {
  try {
    const { supabase, userId, workerId } = await getAgentContext(request)
    const fields = setupSchema.parse(await request.json())
    const worker = await updateWorker(supabase, userId, workerId, {
      setup_state: fields.setup_state,
    })

    return json({
      worker: {
        id: worker.id,
        setup_state: worker.setup_state,
      },
    })
  } catch (error) {
    return handleAgentError(error)
  }
}
