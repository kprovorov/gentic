import {
  ackMessagesSchema,
  ensureIssueOwned,
  getAgentContext,
  handleAgentError,
  insertMessageSchema,
  json,
} from "../../../_lib"
import type { Json } from "@gentic/supabase/types"

export const runtime = "nodejs"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { supabase, userId } = await getAgentContext(request)

    await ensureIssueOwned(supabase, userId, id)

    const { data, error } = await supabase
      .from("messages")
      .select("id, content, created_at, seq")
      .eq("issue_id", id)
      .eq("role", "user")
      .is("consumed_by_run_id", null)
      .order("seq", { ascending: true })

    if (error) {
      throw new Error(error.message)
    }

    return json({ messages: data ?? [] })
  } catch (error) {
    return handleAgentError(error)
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const fields = ackMessagesSchema.parse(await request.json())
    const { supabase, userId } = await getAgentContext(request)

    await ensureIssueOwned(supabase, userId, id)

    const { error } = await supabase
      .from("messages")
      .update({
        consumed_by_run_id: fields.run_id,
        consumed_at: new Date().toISOString(),
      })
      .eq("issue_id", id)
      .eq("role", "user")
      .is("consumed_by_run_id", null)
      .in("id", fields.message_ids)

    if (error) {
      throw new Error(error.message)
    }

    return json({ ok: true })
  } catch (error) {
    return handleAgentError(error)
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const fields = insertMessageSchema.parse(await request.json())
    const { supabase, userId } = await getAgentContext(request)

    await ensureIssueOwned(supabase, userId, id)

    const { data, error } = await supabase
      .from("messages")
      .upsert(
        {
          ...(fields.id ? { id: fields.id } : {}),
          issue_id: id,
          role: fields.role,
          kind: fields.kind ?? "text",
          content: fields.content,
          status: fields.status ?? "complete",
          event_id: fields.event_id ?? null,
          run_id: fields.run_id ?? null,
          event_type: fields.event_type ?? null,
          event_status: fields.event_status ?? null,
          event_ts: fields.event_ts ?? null,
          event_seq: fields.event_seq ?? null,
          tool_call_id: fields.tool_call_id ?? null,
          payload: (fields.payload ?? null) as Json,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      )
      .select("id")
      .maybeSingle()

    if (error) {
      throw new Error(error.message)
    }

    const messageId = data?.id ?? fields.id
    if (!messageId) {
      throw new Error("Message insert did not return an id")
    }

    return json({ id: messageId })
  } catch (error) {
    return handleAgentError(error)
  }
}
