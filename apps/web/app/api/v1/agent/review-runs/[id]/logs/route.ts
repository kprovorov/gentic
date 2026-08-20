import { appendReviewRunLog } from "@gentic/services/review-run-logs"
import { reviewRunLogInputSchema } from "@gentic/validators/agent"

import {
  ensureActiveReviewRunClaim,
  getAgentContext,
  handleAgentError,
  json,
} from "../../../_lib"

export const runtime = "nodejs"

// Durable persistence for the Review Run log sink (GEN-415). The worker also
// broadcasts the same line over the `review-run:{id}` realtime topic for live
// streaming (see the realtime-broadcast RLS policies added alongside
// `review_run_logs`); this route is the source of truth once the process
// exits.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { supabase, userId, workerId } = await getAgentContext(request)
    await ensureActiveReviewRunClaim(supabase, userId, workerId, id)

    const fields = reviewRunLogInputSchema.parse(await request.json())
    await appendReviewRunLog(supabase, id, fields)

    return json({ ok: true })
  } catch (error) {
    return handleAgentError(error)
  }
}
