import {
  markWorkerOffline,
  recordWorkerHeartbeat,
} from "@gentic/services/workers"
import {
  workerHeartbeatTelemetrySchema,
  workerOfflineInputSchema,
} from "@gentic/validators/workers"

import {
  getAgentContext,
  handleAgentError,
  json,
} from "../../_lib"

export const runtime = "nodejs"

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const telemetry = workerHeartbeatTelemetrySchema.parse(body)
    const { supabase, userId, workerId } = await getAgentContext(request)

    await recordWorkerHeartbeat(supabase, userId, workerId, telemetry)

    return json({ ok: true })
  } catch (error) {
    return handleAgentError(error)
  }
}

export async function DELETE(request: Request) {
  try {
    workerOfflineInputSchema.parse(await request.json().catch(() => ({})))
    const { supabase, userId, workerId } = await getAgentContext(request)

    await markWorkerOffline(supabase, userId, workerId)

    return json({ ok: true })
  } catch (error) {
    return handleAgentError(error)
  }
}
