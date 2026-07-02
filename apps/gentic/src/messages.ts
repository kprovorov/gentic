import type { SupabaseClient } from "@supabase/supabase-js"

export type Supabase = SupabaseClient

/**
 * An assistant message that is written to `messages` incrementally as the agent
 * streams text. The first chunk inserts a `streaming` row; later chunks
 * throttle-update its content so Supabase Realtime pushes the growth to the
 * browser without a write per token. `finalize` marks the row `complete`.
 */
export class StreamingAssistantMessage {
  private id: string | null = null
  private content = ""
  private dirty = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly supabase: Supabase,
    private readonly issueId: string,
    private readonly kind: "text" | "thinking" = "text",
    private readonly flushIntervalMs = 250
  ) {}

  async append(text: string): Promise<void> {
    if (!text) {
      return
    }
    this.content += text

    if (!this.id) {
      const { data, error } = await this.supabase
        .from("messages")
        .insert({
          issue_id: this.issueId,
          role: "assistant",
          kind: this.kind,
          content: this.content,
          status: "streaming",
        })
        .select("id")
        .single()

      if (error) {
        throw new Error(error.message)
      }
      this.id = (data as { id: string }).id
      return
    }

    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    this.dirty = true
    if (this.timer) {
      return
    }
    this.timer = setTimeout(() => {
      void this.flush()
    }, this.flushIntervalMs)
  }

  private async flush(): Promise<void> {
    this.timer = null
    if (!this.dirty || !this.id) {
      return
    }
    this.dirty = false
    await this.supabase
      .from("messages")
      .update({ content: this.content, updated_at: new Date().toISOString() })
      .eq("id", this.id)
  }

  async finalize(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.id) {
      return
    }
    await this.supabase
      .from("messages")
      .update({
        content: this.content,
        status: "complete",
        updated_at: new Date().toISOString(),
      })
      .eq("id", this.id)
  }

  get started(): boolean {
    return this.id !== null
  }
}

export async function insertMessage(
  supabase: Supabase,
  issueId: string,
  fields: {
    role: "assistant" | "system"
    kind?: "text" | "tool" | "thinking"
    content: string
    status?: "streaming" | "complete" | "error"
  }
): Promise<void> {
  const { error } = await supabase.from("messages").insert({
    issue_id: issueId,
    role: fields.role,
    kind: fields.kind ?? "text",
    content: fields.content,
    status: fields.status ?? "complete",
  })
  if (error) {
    throw new Error(error.message)
  }
}

export async function setRunState(
  supabase: Supabase,
  issueId: string,
  fields: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from("issues")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", issueId)
  if (error) {
    throw new Error(error.message)
  }
}
