import {
  ApiError,
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

    const { data, error } = await supabase
      .rpc("ack_issue_run_messages", {
        p_issue_id: id,
        p_run_id: fields.run_id,
        p_message_ids: fields.message_ids,
      })
      .single<boolean>()

    if (error) {
      throw new Error(error.message)
    }
    if (!data) {
      throw new ApiError(409, "Run is no longer active")
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
      .rpc("insert_run_message", {
        p_issue_id: id,
        p_run_id: fields.run_id,
        p_message_id: fields.id ?? null,
        p_role: fields.role,
        p_kind: fields.kind ?? null,
        p_content: fields.content,
        p_status: fields.status ?? null,
        p_event_id: fields.event_id ?? null,
        p_event_type: fields.event_type ?? null,
        p_event_status: fields.event_status ?? null,
        p_event_ts: fields.event_ts ?? null,
        p_event_seq: fields.event_seq ?? null,
        p_tool_call_id: fields.tool_call_id ?? null,
        p_payload: (fields.payload ?? null) as Json,
      })
      .single<string>()

    if (error) {
      if (error.code === "P0001") {
        throw new ApiError(409, "Run is no longer active")
      }
      throw new Error(error.message)
    }

    const messageId = data ?? fields.id
    if (!messageId) {
      throw new Error("Message insert did not return an id")
    }

    return json({ id: messageId })
  } catch (error) {
    return handleAgentError(error)
  }
}
