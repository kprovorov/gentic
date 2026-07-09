import {
  ensureIssueOwned,
  getAgentContext,
  handleAgentError,
  json,
  runStateSchema,
} from "../../../_lib"

export const runtime = "nodejs"

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const fields = runStateSchema.parse(await request.json())
    const { supabase, userId } = await getAgentContext(request)

    await ensureIssueOwned(supabase, userId, id)

    const marksReadyForReview =
      fields.run_status === "completed" && Boolean(fields.pr_url)
    const marksHeld = fields.run_status === "held"

    const { error } = await supabase
      .from("issues")
      .update({
        ...fields,
        ...(marksReadyForReview ? { status: "ready-for-review" } : {}),
        ...(marksHeld ? { status: "todo" } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)

    if (error) {
      throw new Error(error.message)
    }

    return json({ ok: true })
  } catch (error) {
    return handleAgentError(error)
  }
}
