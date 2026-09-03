import { markHostOffline, recordHostHeartbeat } from "@gentic/services/hosts"
import {
  hostHeartbeatTelemetrySchema,
  hostOfflineInputSchema,
} from "@gentic/validators/hosts"

import { getAgentContext, handleAgentError, json } from "../../_lib"

export const runtime = "nodejs"

export async function PATCH(request: Request) {
  try {
    const { supabase, userId, hostId } = await getAgentContext(request)
    const body = await request.json()
    const telemetry = hostHeartbeatTelemetrySchema.parse(body)

    await recordHostHeartbeat(supabase, userId, hostId, telemetry)

    return json({ ok: true })
  } catch (error) {
    return handleAgentError(error)
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, userId, hostId } = await getAgentContext(request)
    hostOfflineInputSchema.parse(await request.json().catch(() => ({})))

    await markHostOffline(supabase, userId, hostId)

    return json({ ok: true })
  } catch (error) {
    return handleAgentError(error)
  }
}
