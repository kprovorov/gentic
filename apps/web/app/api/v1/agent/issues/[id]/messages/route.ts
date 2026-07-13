import {
  ensureIssueOwned,
  getAgentContext,
  handleAgentError,
  insertMessageSchema,
  json,
} from "../../../_lib"

export const runtime = "nodejs"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const cursor = new URL(request.url).searchParams.get("after")
    const { supabase, userId } = await getAgentContext(request)

    if (!cursor) {
      return json({ error: "Missing after cursor" }, { status: 400 })
    }

    await ensureIssueOwned(supabase, userId, id)

    const { data, error } = await supabase
      .from("messages")
      .select("id, content, created_at")
      .eq("issue_id", id)
      .eq("role", "user")
      .gt("created_at", cursor)
      .order("created_at", { ascending: true })

    if (error) {
      throw new Error(error.message)
    }

    return json({ messages: data ?? [] })
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
        },
        { onConflict: "id", ignoreDuplicates: true }
      )
      .select("id")
      .maybeSingle<{ id: string }>()

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
