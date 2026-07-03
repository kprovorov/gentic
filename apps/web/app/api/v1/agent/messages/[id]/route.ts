import {
  ensureMessageOwned,
  getAgentContext,
  handleAgentError,
  json,
  updateMessageSchema,
} from "../../_lib"

export const runtime = "nodejs"

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const fields = updateMessageSchema.parse(await request.json())
    const { supabase, userId } = await getAgentContext(request)

    await ensureMessageOwned(supabase, userId, id)

    const { error } = await supabase
      .from("messages")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id)

    if (error) {
      throw new Error(error.message)
    }

    return json({ ok: true })
  } catch (error) {
    return handleAgentError(error)
  }
}
