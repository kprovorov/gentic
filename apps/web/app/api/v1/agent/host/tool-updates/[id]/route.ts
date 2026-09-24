import { reportHostToolUpdateResult } from "@gentic/services/host-tool-updates"
import { reportHostToolUpdateResultInputSchema } from "@gentic/validators/host-tool-updates"

import {
  ApiError,
  getAgentContext,
  handleAgentError,
  json,
} from "../../../_lib"

export const runtime = "nodejs"

export async function PATCH(
  request: Request,
  routeContext: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, hostId } = await getAgentContext(request)
    const { id } = await routeContext.params
    if (!id) {
      throw new ApiError(400, "Missing tool update id")
    }

    const fields = reportHostToolUpdateResultInputSchema.parse(
      await request.json()
    )
    await reportHostToolUpdateResult(supabase, hostId, id, fields)

    return json({ ok: true })
  } catch (error) {
    return handleAgentError(error)
  }
}
