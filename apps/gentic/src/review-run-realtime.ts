import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from "@supabase/supabase-js"
import {
  reviewRunRealtimeTopic,
  REALTIME_MESSAGE_EVENT,
  type ReviewRunLogEvent,
} from "@gentic/validators/realtime"

import type { AgentApi } from "./api.js"

export type { ReviewRunLogEvent } from "@gentic/validators/realtime"

// Refresh a bit before the token actually expires, mirroring realtime.ts's
// issue-channel token lifecycle.
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000

export interface ReviewRunRealtimeChannel {
  publishLog(event: Omit<ReviewRunLogEvent, "ts">): Promise<void>
  close(): Promise<void>
}

/**
 * Joins the private `review-run:{id}` Broadcast channel the Review Run log
 * sink streams into — deliberately a separate channel from `realtime.ts`'s
 * `connectIssueChannel` (Issue chat), per GEN-415's "stream execution logs
 * to the Review Run log sink, not Issue chat" requirement.
 *
 * Unlike Issue chat, this is one-directional (host -> browser only): a
 * review run is a single, non-interactive turn, so there is no inbound
 * "wake up for a new prompt" event to listen for.
 */
export async function connectReviewRunChannel(
  api: AgentApi,
  reviewRunId: string
): Promise<ReviewRunRealtimeChannel> {
  const token = await api.fetchReviewRunRealtimeToken(reviewRunId)
  const client = createClient(token.url, token.apiKey)
  await client.realtime.setAuth(token.token)

  const channel = client.channel(reviewRunRealtimeTopic(reviewRunId), {
    config: { private: true },
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

  return new SupabaseReviewRunRealtimeChannel(
    api,
    reviewRunId,
    client,
    channel,
    token.expiresAt
  )
}

class SupabaseReviewRunRealtimeChannel implements ReviewRunRealtimeChannel {
  private refreshTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly api: AgentApi,
    private readonly reviewRunId: string,
    private readonly client: SupabaseClient,
    private readonly channel: RealtimeChannel,
    expiresAt: string
  ) {
    this.scheduleRefresh(expiresAt)
  }

  async publishLog(event: Omit<ReviewRunLogEvent, "ts">): Promise<void> {
    await this.channel.send({
      type: "broadcast",
      event: REALTIME_MESSAGE_EVENT,
      payload: {
        ...event,
        ts: new Date().toISOString(),
      } satisfies ReviewRunLogEvent,
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
      const token = await this.api.fetchReviewRunRealtimeToken(
        this.reviewRunId
      )
      await this.client.realtime.setAuth(token.token)
      this.scheduleRefresh(token.expiresAt)
    } catch {
      // Try again soon rather than leaving the channel to silently expire.
      this.refreshTimer = setTimeout(() => void this.refresh(), 30_000)
    }
  }
}
