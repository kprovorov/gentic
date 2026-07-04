import type { AgentApi, MessageFields, RunStateFields } from "./api.js"

/**
 * An assistant message that is written to the issue transcript incrementally as
 * the agent streams text. The first chunk inserts a `streaming` row; later
 * chunks throttle-update its content so the browser sees growth without a write
 * per token. `finalize` marks the row `complete`.
 */
export class StreamingAssistantMessage {
  private id: string | null = null
  private content = ""
  private dirty = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly api: AgentApi,
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
      this.id = await this.api.insertMessage(this.issueId, {
        role: "assistant",
        kind: this.kind,
        content: this.content,
        status: "streaming",
      })
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
    await this.api.updateMessage(this.id, { content: this.content })
  }

  async finalize(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.id) {
      return
    }
    await this.api.updateMessage(this.id, {
      content: this.content,
      status: "complete",
    })
  }

  get started(): boolean {
    return this.id !== null
  }
}

export async function insertMessage(
  api: AgentApi,
  issueId: string,
  fields: MessageFields
): Promise<void> {
  await api.insertMessage(issueId, {
    kind: "text",
    status: "complete",
    ...fields,
  })
}

export async function setRunState(
  api: AgentApi,
  issueId: string,
  fields: RunStateFields
): Promise<void> {
  await api.setRunState(issueId, fields)
}
