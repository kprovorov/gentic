import {
  ensureActiveReviewRunClaim,
  getAgentContext,
  handleAgentError,
  json,
} from "../../../_lib"

export const runtime = "nodejs"

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { supabase, userId, workerId } = await getAgentContext(request)
    await ensureActiveReviewRunClaim(supabase, userId, workerId, id)

    const { error } = await supabase
      .from("review_runs")
      .update({ heartbeat_at: new Date().toISOString() })
      .eq("id", id)
      .eq("claimed_by_worker_id", workerId)
      .eq("status", "running")

    if (error) {
      throw new Error(error.message)
    }

    return json({ ok: true })
  } catch (error) {
    return handleAgentError(error)
  }
}
