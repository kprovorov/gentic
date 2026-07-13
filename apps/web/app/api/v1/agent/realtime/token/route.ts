import { mintRealtimeToken } from "@/lib/realtime-token"

import { getAgentContext, handleAgentError, json } from "../../_lib"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const { userId } = await getAgentContext(request)
    const token = await mintRealtimeToken(userId)
    return json(token)
  } catch (error) {
    return handleAgentError(error)
  }
}
