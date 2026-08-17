import {
  markWorkerOffline,
  recordWorkerHeartbeat,
} from "@gentic/services/workers"
import {
  workerHeartbeatTelemetrySchema,
  workerOfflineInputSchema,
} from "@gentic/validators/workers"

import { getAgentContext, handleAgentError, json } from "../../_lib"

export const runtime = "nodejs"

export async function PATCH(request: Request) {
  try {
    const { supabase, userId, workerId } = await getAgentContext(request)
    const body = await request.json()
    const telemetry = workerHeartbeatTelemetrySchema.parse(body)

    await recordWorkerHeartbeat(supabase, userId, workerId, telemetry)

    return json({ ok: true })
  } catch (error) {
    return handleAgentError(error)
  }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, userId, workerId } = await getAgentContext(request)
    workerOfflineInputSchema.parse(await request.json().catch(() => ({})))

    await markWorkerOffline(supabase, userId, workerId)

    return json({ ok: true })
  } catch (error) {
    return handleAgentError(error)
  }
}
