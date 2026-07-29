import { mintRealtimeToken } from "@/lib/realtime-token"

import {
  ensureActiveWorkerRun,
  getAgentContext,
  handleAgentError,
  json,
  realtimeTokenSchema,
} from "../../_lib"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const fields = realtimeTokenSchema.parse(await request.json())
    const { supabase, userId, workerId } = await getAgentContext(request)
    await ensureActiveWorkerRun(
      supabase,
      userId,
      workerId,
      fields.issue_id,
      fields.active_run_id
    )
    const token = await mintRealtimeToken(userId)
    return json(token)
  } catch (error) {
    return handleAgentError(error)
  }
}
