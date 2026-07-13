import { randomUUID } from "node:crypto"

import type { AgentApi, RunStateFields } from "./api.js"
import type { IssueRealtimeChannel } from "./realtime.js"

/**
 * An assistant message streamed into the issue transcript incrementally as
 * the agent produces text. Each chunk publishes a full-content `message`
 * snapshot to the issue's realtime channel, throttled so the browser sees
 * growth without a broadcast per token. `finalize` publishes it `complete`.
 */
export class StreamingAssistantMessage {
  private readonly id = randomUUID()
  private seq = 0
  private content = ""
  private dirty = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private started = false

  constructor(
    private readonly channel: IssueRealtimeChannel,
    private readonly kind: "text" | "thinking" = "text",
    private readonly flushIntervalMs = 150
  ) {}

  async append(text: string): Promise<void> {
    if (!text) {
      return
    }
    this.content += text

    if (!this.started) {
      this.started = true
      await this.publish("streaming")
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
    if (!this.dirty) {
      return
    }
    this.dirty = false
    await this.publish("streaming")
  }

  async finalize(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (!this.started) {
      return
    }
    await this.publish("complete")
  }

  private async publish(
    status: "streaming" | "complete" | "error"
  ): Promise<void> {
    this.seq += 1
    await this.channel.publishMessage({
      id: this.id,
      seq: this.seq,
      role: "assistant",
      kind: this.kind,
      content: this.content,
      status,
    })
  }
}

/** Publishes a single, already-complete assistant message (e.g. a tool call). */
export async function publishMessage(
  channel: IssueRealtimeChannel,
  fields: {
    kind?: "text" | "tool" | "thinking"
    content: string
    status?: "streaming" | "complete" | "error"
  }
): Promise<void> {
  await channel.publishMessage({
    id: randomUUID(),
    seq: 1,
    role: "assistant",
    kind: fields.kind ?? "text",
    content: fields.content,
    status: fields.status ?? "complete",
  })
}

/**
 * Persists run state via the REST PATCH (the source of truth) and, when a
 * channel is available and the update includes a status transition,
 * additionally broadcasts it for instant UI updates.
 */
export async function setRunState(
  api: AgentApi,
  channel: IssueRealtimeChannel | null,
  issueId: string,
  fields: RunStateFields
): Promise<void> {
  await api.setRunState(issueId, fields)

  if (channel && fields.status) {
    await channel.publishRunState({
      status: fields.status,
      pr_url: fields.pr_url ?? null,
      usage_limit_reset_at: fields.usage_limit_reset_at ?? null,
      run_error: fields.run_error ?? null,
    })
  }
}
