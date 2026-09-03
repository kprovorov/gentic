import { reportHostSkillInstallResult } from "@gentic/services/skills"
import { reportHostSkillInstallResultInputSchema } from "@gentic/validators/skills"

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
      throw new ApiError(400, "Missing skill install id")
    }

    const fields = reportHostSkillInstallResultInputSchema.parse(
      await request.json()
    )
    await reportHostSkillInstallResult(supabase, hostId, id, fields)

    return json({ ok: true })
  } catch (error) {
    return handleAgentError(error)
  }
}
