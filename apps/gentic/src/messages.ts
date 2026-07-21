import { createHash, randomUUID } from "node:crypto"
import { setTimeout as sleep } from "node:timers/promises"

import type { AgentApi, RunStateFields } from "./api.js"
import { logError } from "./log.js"
import type { IssueRealtimeChannel } from "./realtime.js"

const DEFAULT_PERSIST_RETRY_DELAYS_MS = [250, 1_000, 3_000]

type MessageKind = "text" | "tool" | "thinking" | "plan" | "mode" | "commands"
type MessageStatus = "streaming" | "complete" | "error"
type EventType =
  | "text"
  | "thought"
  | "tool_call"
  | "plan"
  | "mode"
  | "available_commands"
type EventStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "removed"

export interface StructuredMessageFields {
  id: string
  role: "assistant" | "system"
  kind: MessageKind
  content: string
  status: MessageStatus
  event_id?: string | null
  run_id?: string | null
  event_type?: EventType | null
  event_status?: EventStatus | null
  event_ts?: string | null
  event_seq?: number | null
  tool_call_id?: string | null
  payload?: Record<string, unknown> | null
}

interface PersistOptions {
  retryDelaysMs?: readonly number[]
}

/**
 * An assistant message streamed into the issue transcript incrementally as
 * the agent produces text. Each chunk publishes a full-content `message`
 * snapshot to the issue's realtime channel, throttled so the browser sees growth
 * without a broadcast per token. `finalize` persists the completed message once
 * using the same id, then publishes the durable `complete` snapshot.
 */
export class StreamingAssistantMessage {
  private readonly id: string
  private seq = 0
  private content = ""
  private dirty = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private started = false
  private finalized = false
  private lastEventTs: string | null = null

  constructor(
    private readonly api: AgentApi,
    private readonly issueId: string,
    private readonly channel: IssueRealtimeChannel,
    private readonly kind: "text" | "thinking" = "text",
    private readonly flushIntervalMs = 150,
    private readonly persistOptions: PersistOptions = {},
    id?: string,
    private readonly runId?: string | null,
    private readonly eventId?: string | null
  ) {
    this.id = id ?? randomUUID()
  }

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
    if (!this.started || this.finalized) {
      return
    }
    const eventTs = new Date().toISOString()
    const eventSeq = this.seq + 1
    await persistMessageWithRetry(
      this.api,
      this.issueId,
      {
        id: this.id,
        role: "assistant",
        kind: this.kind,
        content: this.content,
        status: "complete",
        event_id: this.eventId ?? this.id,
        run_id: this.runId ?? null,
        event_type: this.kind === "thinking" ? "thought" : "text",
        event_status: "completed",
        event_ts: eventTs,
        event_seq: eventSeq,
        payload: { content: this.content },
      },
      this.persistOptions
    )
    this.finalized = true
    await this.publish("complete", eventTs)
  }

  async persistPartialError(): Promise<void> {
    if (!this.started || this.finalized) {
      return
    }
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const eventTs = new Date().toISOString()
    const eventSeq = this.seq + 1
    await persistMessageWithRetry(
      this.api,
      this.issueId,
      {
        id: this.id,
        role: "assistant",
        kind: this.kind,
        content: this.content,
        status: "error",
        event_id: this.eventId ?? this.id,
        run_id: this.runId ?? null,
        event_type: this.kind === "thinking" ? "thought" : "text",
        event_status: "failed",
        event_ts: eventTs,
        event_seq: eventSeq,
        payload: { content: this.content },
      },
      this.persistOptions
    )
    this.finalized = true
    await this.publish("error", eventTs).catch((error) => {
      logError("failed to publish errored assistant message:", describe(error))
    })
  }

  private async publish(
    status: "streaming" | "complete" | "error",
    eventTs = new Date().toISOString()
  ): Promise<void> {
    this.seq += 1
    this.lastEventTs = eventTs
    await publishRealtimeMessage(this.channel, {
      id: this.id,
      seq: this.seq,
      role: "assistant",
      kind: this.kind,
      content: this.content,
      status,
      event_id: this.eventId ?? this.id,
      run_id: this.runId ?? null,
      event_type: this.kind === "thinking" ? "thought" : "text",
      event_status:
        status === "streaming"
          ? "in_progress"
          : status === "error"
            ? "failed"
            : "completed",
      event_ts: eventTs,
      event_seq: this.seq,
      payload: { content: this.content },
    })
  }
}

/** Publishes a single, already-complete assistant message (e.g. a tool call). */
export async function publishMessage(
  api: AgentApi,
  issueId: string,
  channel: IssueRealtimeChannel,
  fields: {
    kind?: "text" | "tool" | "thinking"
    content: string
    status?: "complete" | "error"
    persistOptions?: PersistOptions
  }
): Promise<void> {
  const id = randomUUID()
  const status = fields.status ?? "complete"
  await persistMessageWithRetry(
    api,
    issueId,
    {
      id,
      role: "assistant",
      kind: fields.kind ?? "text",
      content: fields.content,
      status,
    },
    fields.persistOptions
  )
  await publishRealtimeMessage(channel, {
    id,
    seq: 1,
    role: "assistant",
    kind: fields.kind ?? "text",
    content: fields.content,
    status,
  })
}

export function stableMessageId(parts: readonly string[]): string {
  const hex = createHash("sha256").update(parts.join("\u001f")).digest("hex")
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80)
      .toString(16)
      .padStart(2, "0") + hex.slice(18, 20),
    hex.slice(20, 32),
  ].join("-")
}

export async function publishStructuredMessage(
  api: AgentApi,
  issueId: string,
  channel: IssueRealtimeChannel,
  fields: StructuredMessageFields,
  persistOptions?: PersistOptions
): Promise<void> {
  const eventTs = fields.event_ts ?? new Date().toISOString()
  const message = { ...fields, event_ts: eventTs }
  await persistMessageWithRetry(api, issueId, message, persistOptions)
  await publishRealtimeMessage(channel, {
    id: message.id,
    seq: message.event_seq ?? 1,
    role: message.role,
    kind: message.kind,
    content: message.content,
    status: message.status,
    event_id: message.event_id ?? null,
    run_id: message.run_id ?? null,
    event_type: message.event_type ?? null,
    event_status: message.event_status ?? null,
    event_ts: message.event_ts,
    event_seq: message.event_seq ?? null,
    tool_call_id: message.tool_call_id ?? null,
    payload: message.payload ?? null,
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
    }).catch((error) => {
      logError("failed to publish run state:", describe(error))
    })
  }
}

async function publishRealtimeMessage(
  channel: IssueRealtimeChannel,
  event: Parameters<IssueRealtimeChannel["publishMessage"]>[0]
): Promise<void> {
  await channel.publishMessage(event).catch((error) => {
    logError("failed to publish assistant message:", describe(error))
  })
}

async function persistMessageWithRetry(
  api: AgentApi,
  issueId: string,
  message: {
    id: string
    role: "assistant" | "system"
    kind: MessageKind
    content: string
    status: MessageStatus
    event_id?: string | null
    run_id?: string | null
    event_type?: EventType | null
    event_status?: EventStatus | null
    event_ts?: string | null
    event_seq?: number | null
    tool_call_id?: string | null
    payload?: Record<string, unknown> | null
  },
  options: PersistOptions = {}
): Promise<void> {
  const retryDelaysMs =
    options.retryDelaysMs ?? DEFAULT_PERSIST_RETRY_DELAYS_MS
  let attempt = 0

  for (;;) {
    try {
      await api.insertMessage(issueId, message)
      return
    } catch (error) {
      const delay = retryDelaysMs[attempt]
      if (delay === undefined) {
        logError(
          `failed to persist finalized message ${message.id}:`,
          describe(error)
        )
        throw error
      }
      attempt += 1
      await sleep(delay)
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
