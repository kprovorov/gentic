import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from "@supabase/supabase-js"
import {
  issueRealtimeTopic,
  REALTIME_MESSAGE_EVENT,
  REALTIME_RUN_STATE_EVENT,
  REALTIME_USER_MESSAGE_EVENT,
  userMessageEventSchema,
  type MessageEvent as RealtimeMessageEvent,
  type RunStateEvent as RealtimeRunStateEvent,
  type UserMessageEvent as RealtimeUserMessageEvent,
} from "@gentic/validators/realtime"

import type { AgentApi } from "./api.js"

export type {
  MessageEvent as RealtimeMessageEvent,
  RunStateEvent as RealtimeRunStateEvent,
  UserMessageEvent as RealtimeUserMessageEvent,
} from "@gentic/validators/realtime"

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
 * agent conversation (see docs/realtime-transport.md). Rejects if the
 * channel can't be joined — callers should treat that like any other
 * startup failure; there is no REST fallback in this phase.
 */
export async function connectIssueChannel(
  api: AgentApi,
  issueId: string,
  onUserMessage: (event: RealtimeUserMessageEvent) => void
): Promise<IssueRealtimeChannel> {
  const token = await api.fetchRealtimeToken()
  const client = createClient(token.url, token.apiKey)
  await client.realtime.setAuth(token.token)

  const channel = client.channel(issueRealtimeTopic(issueId), {
    config: { private: true },
  })

  channel.on("broadcast", { event: REALTIME_USER_MESSAGE_EVENT }, ({ payload }) => {
    const event = userMessageEventSchema.safeParse(payload)
    if (event.success) {
      onUserMessage(event.data)
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
      event: REALTIME_MESSAGE_EVENT,
      payload: { ...event, ts: new Date().toISOString() } satisfies RealtimeMessageEvent,
    })
  }

  async publishRunState(
    event: Omit<RealtimeRunStateEvent, "ts">
  ): Promise<void> {
    await this.channel.send({
      type: "broadcast",
      event: REALTIME_RUN_STATE_EVENT,
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
