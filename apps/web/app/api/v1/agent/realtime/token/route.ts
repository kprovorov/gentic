import { mintRealtimeToken } from "@/lib/realtime-token"

import {
  ensureActiveReviewRunClaim,
  ensureActiveWorkerRun,
  getAgentContext,
  handleAgentError,
  json,
  realtimeTokenSchema,
} from "../../_lib"

export const runtime = "nodejs"

// Mints one token shape for two distinct private channels: Issue chat
// (`issue:{id}`) and the Review Run log sink (`review-run:{id}`, GEN-415).
// The minted JWT itself is user-scoped, not topic-scoped — which channel it
// can actually join is enforced by separate `realtime.messages` RLS policies
// per topic prefix — so ownership only needs checking once, here, before
// minting.
export async function POST(request: Request) {
  try {
    const fields = realtimeTokenSchema.parse(await request.json())
    const { supabase, userId, workerId } = await getAgentContext(request)

    if ("review_run_id" in fields) {
      await ensureActiveReviewRunClaim(
        supabase,
        userId,
        workerId,
        fields.review_run_id
      )
    } else {
      await ensureActiveWorkerRun(
        supabase,
        userId,
        workerId,
        fields.issue_id,
        fields.active_run_id
      )
    }

    const token = await mintRealtimeToken(userId)
    return json(token)
  } catch (error) {
    return handleAgentError(error)
  }
}
