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
    const cursorParam = new URL(request.url).searchParams.get("after")
    const cursor = Number(cursorParam)
    const { supabase, userId } = await getAgentContext(request)

    if (cursorParam === null || !Number.isSafeInteger(cursor) || cursor < 0) {
      return json({ error: "Missing after cursor" }, { status: 400 })
    }

    await ensureIssueOwned(supabase, userId, id)

    const { data, error } = await supabase
      .from("messages")
      .select("id, content, created_at, seq")
      .eq("issue_id", id)
      .eq("role", "user")
      .gt("seq", cursor)
      .order("seq", { ascending: true })

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
          ...(fields.run_id !== undefined ? { run_id: fields.run_id } : {}),
          issue_id: id,
          role: fields.role,
          kind: fields.kind ?? "text",
          content: fields.content,
          status: fields.status ?? "complete",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      )
      .select("id, seq, created_at")
      .maybeSingle<{ id: string; seq: number; created_at: string }>()

    if (error) {
      throw new Error(error.message)
    }

    if (!data) {
      throw new Error("Message insert did not return an id")
    }

    return json(data)
  } catch (error) {
    return handleAgentError(error)
  }
}
