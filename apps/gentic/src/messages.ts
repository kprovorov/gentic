import { randomUUID } from "node:crypto"
import { setTimeout as sleep } from "node:timers/promises"

import type { AgentApi, PersistedMessage, RunStateFields } from "./api.js"
import { logError } from "./log.js"
import type { IssueRealtimeChannel } from "./realtime.js"

const DEFAULT_PERSIST_RETRY_DELAYS_MS = [250, 1_000, 3_000]

interface PersistOptions {
  retryDelaysMs?: readonly number[]
}

/**
 * An assistant message streamed into the issue transcript incrementally as
 * the agent produces text. Each chunk publishes a full-content `message`
 * snapshot to the issue's realtime channel, throttled so the browser sees growth
 * without a broadcast per token. `finalize` publishes it `complete`, then
 * persists the completed message once using the same id.
 */
export class StreamingAssistantMessage {
  private readonly id = randomUUID()
  private seq = 0
  private content = ""
  private dirty = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private started = false
  private finalized = false
  private persisted: PersistedMessage | null = null

  constructor(
    private readonly api: AgentApi,
    private readonly issueId: string,
    private readonly runId: string,
    private readonly channel: IssueRealtimeChannel,
    private readonly kind: "text" | "thinking" = "text",
    private readonly flushIntervalMs = 150,
    private readonly persistOptions: PersistOptions = {}
  ) {}

  async append(text: string): Promise<void> {
    if (!text) {
      return
    }
    this.content += text

    if (!this.started) {
      this.started = true
      this.persisted = await persistMessageWithRetry(
        this.api,
        this.issueId,
        {
          id: this.id,
          run_id: this.runId,
          role: "assistant",
          kind: this.kind,
          content: this.content,
          status: "streaming",
        },
        this.persistOptions
      )
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
    this.finalized = true
    const persisted = await persistMessageWithRetry(
      this.api,
      this.issueId,
      {
        id: this.id,
        run_id: this.runId,
        role: "assistant",
        kind: this.kind,
        content: this.content,
        status: "complete",
      },
      this.persistOptions
    )
    this.persisted = persisted ?? this.persisted
    await this.publish("complete")
  }

  async persistPartialError(): Promise<void> {
    if (!this.started || this.finalized) {
      return
    }
    this.finalized = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const persisted = await persistMessageWithRetry(
      this.api,
      this.issueId,
      {
        id: this.id,
        run_id: this.runId,
        role: "assistant",
        kind: this.kind,
        content: this.content,
        status: "error",
      },
      this.persistOptions
    )
    this.persisted = persisted ?? this.persisted
    await this.publish("error").catch((error) => {
      logError("failed to publish errored assistant message:", describe(error))
    })
  }

  private async publish(
    status: "streaming" | "complete" | "error"
  ): Promise<void> {
    this.seq += 1
    await this.channel.publishMessage({
      id: this.id,
      seq: this.seq,
      message_seq: this.persisted?.seq ?? null,
      role: "assistant",
      kind: this.kind,
      content: this.content,
      status,
    })
  }
}

/** Publishes a single, already-complete assistant message (e.g. a tool call). */
export async function publishMessage(
  api: AgentApi,
  issueId: string,
  runId: string,
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
  const persisted = await persistMessageWithRetry(
    api,
    issueId,
    {
      id,
      run_id: runId,
      role: "assistant",
      kind: fields.kind ?? "text",
      content: fields.content,
      status,
    },
    fields.persistOptions
  )
  await channel.publishMessage({
    id,
    seq: 1,
    message_seq: persisted?.seq ?? null,
    role: "assistant",
    kind: fields.kind ?? "text",
    content: fields.content,
    status,
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

async function persistMessageWithRetry(
  api: AgentApi,
  issueId: string,
  message: {
    id: string
    run_id?: string
    role: "assistant" | "system"
    kind: "text" | "tool" | "thinking"
    content: string
    status: "streaming" | "complete" | "error"
  },
  options: PersistOptions = {}
): Promise<PersistedMessage | null> {
  const retryDelaysMs =
    options.retryDelaysMs ?? DEFAULT_PERSIST_RETRY_DELAYS_MS
  let attempt = 0

  for (;;) {
    try {
      return await api.insertMessage(issueId, message)
    } catch (error) {
      const delay = retryDelaysMs[attempt]
      if (delay === undefined) {
        logError(
          `failed to persist finalized message ${message.id}:`,
          describe(error)
        )
        return null
      }
      attempt += 1
      await sleep(delay)
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
