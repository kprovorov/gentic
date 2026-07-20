import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from "@supabase/supabase-js"

import type { AgentApi } from "./api.js"

// Mirrors the event contract documented in docs/realtime-transport.md and
// implemented in @gentic/validators/realtime. Kept as plain types (not the
// zod schemas) so the compiled worker never needs a runtime dependency on
// monorepo TypeScript source — it ships as a standalone binary with no
// node_modules on the target machine.
export type RealtimeMessageEvent = {
  id: string
  seq: number
  role: "assistant" | "system"
  kind: "text" | "thinking" | "tool"
  content: string
  status: "streaming" | "complete" | "error"
  ts: string
}

export type RealtimeRunStateEvent = {
  status:
    | "in-progress"
    | "held"
    | "run-failed"
    | "ready-for-review"
    | "waiting-for-input"
  pr_url: string | null
  usage_limit_reset_at: string | null
  run_error: string | null
  ts: string
}

export type RealtimeUserMessageEvent = {
  id: string
  content: string
  created_at: string
}

const MESSAGE_EVENT = "message"
const RUN_STATE_EVENT = "run_state"
const USER_MESSAGE_EVENT = "user_message"

// Refresh a bit before the token actually expires so a slow-running turn
// never races the worker off an expired websocket auth.
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000

export interface IssueRealtimeChannel {
  publishMessage(event: Omit<RealtimeMessageEvent, "ts">): Promise<void>
  publishRunState(event: Omit<RealtimeRunStateEvent, "ts">): Promise<void>
  close(): Promise<void>
}

/**
 * Joins the private `issue:{id}` Broadcast channel used to stream the live
 * agent conversation (see docs/realtime-transport.md). User-message
 * broadcasts are wake-up hints only; callers must fetch durable messages from
 * the database.
 */
export async function connectIssueChannel(
  api: AgentApi,
  issueId: string,
  onUserMessage: () => void
): Promise<IssueRealtimeChannel> {
  const token = await api.fetchRealtimeToken()
  const client = createClient(token.url, token.apiKey)
  await client.realtime.setAuth(token.token)

  const channel = client.channel(`issue:${issueId}`, {
    config: { private: true },
  })

  channel.on("broadcast", { event: USER_MESSAGE_EVENT }, ({ payload }) => {
    const event = payload as Partial<RealtimeUserMessageEvent> | null
    if (
      event &&
      typeof event.id === "string" &&
      typeof event.content === "string" &&
      typeof event.created_at === "string"
    ) {
      onUserMessage()
    }
  })

  await new Promise<void>((resolve, reject) => {
    channel.subscribe((status, error) => {
      if (status === "SUBSCRIBED") {
        resolve()
      } else if (
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT" ||
        status === "CLOSED"
      ) {
        reject(error ?? new Error(`Failed to join realtime channel (${status})`))
      }
    })
  })

  return new SupabaseIssueRealtimeChannel(api, client, channel, token.expiresAt)
}

class SupabaseIssueRealtimeChannel implements IssueRealtimeChannel {
  private refreshTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly api: AgentApi,
    private readonly client: SupabaseClient,
    private readonly channel: RealtimeChannel,
    expiresAt: string
  ) {
    this.scheduleRefresh(expiresAt)
  }

  async publishMessage(event: Omit<RealtimeMessageEvent, "ts">): Promise<void> {
    await this.channel.send({
      type: "broadcast",
      event: MESSAGE_EVENT,
      payload: { ...event, ts: new Date().toISOString() } satisfies RealtimeMessageEvent,
    })
  }

  async publishRunState(
    event: Omit<RealtimeRunStateEvent, "ts">
  ): Promise<void> {
    await this.channel.send({
      type: "broadcast",
      event: RUN_STATE_EVENT,
      payload: {
        ...event,
        ts: new Date().toISOString(),
      } satisfies RealtimeRunStateEvent,
    })
  }

  async close(): Promise<void> {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
    await this.client.removeChannel(this.channel)
  }

  private scheduleRefresh(expiresAt: string): void {
    const delay = Math.max(
      new Date(expiresAt).getTime() - Date.now() - TOKEN_REFRESH_SKEW_MS,
      0
    )
    this.refreshTimer = setTimeout(() => {
      void this.refresh()
    }, delay)
  }

  private async refresh(): Promise<void> {
    try {
      const token = await this.api.fetchRealtimeToken()
      await this.client.realtime.setAuth(token.token)
      this.scheduleRefresh(token.expiresAt)
    } catch {
      // Try again soon rather than leaving the channel to silently expire.
      this.refreshTimer = setTimeout(() => void this.refresh(), 30_000)
    }
  }
}
