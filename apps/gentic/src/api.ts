import {
  attachmentsResponseSchema,
  claimIssueResponseSchema,
  finishRunResponseSchema,
  insertMessageResponseSchema,
  okResponseSchema,
  pendingUserMessagesResponseSchema,
  realtimeTokenResponseSchema,
  type AckMessagesInput,
  type Attachment,
  type ClaimedIssue,
  type FinishRunFields,
  type InsertMessageInput,
  type RealtimeRunStateStatus,
  type RealtimeTokenResponse,
  type RunStateFields,
  type UserMessage,
} from "@gentic/validators/agent"
import type { z } from "zod"

export type {
  AckMessagesInput,
  Attachment,
  ClaimedIssue,
  FinishRunFields,
  InsertMessageInput,
  RealtimeRunStateStatus,
  RealtimeTokenResponse,
  RunStateFields,
  UserMessage,
} from "@gentic/validators/agent"

export type FinishRunResult = {
  finished: boolean
  status: RealtimeRunStateStatus
}

export interface AgentApi {
  claimNextQueuedIssue(): Promise<ClaimedIssue | null>
  setRunState(issueId: string, fields: RunStateFields): Promise<void>
  finishRun(issueId: string, fields: FinishRunFields): Promise<FinishRunResult>
  insertMessage(issueId: string, message: InsertMessageInput): Promise<string>
  fetchPendingUserMessages(issueId: string): Promise<UserMessage[]>
  ackUserMessages(
    issueId: string,
    runId: string,
    messageIds: string[]
  ): Promise<void>
  fetchAttachments(issueId: string, messageId: string): Promise<Attachment[]>
  fetchRealtimeToken(): Promise<RealtimeTokenResponse>
}

export function createAgentApi(input: {
  apiUrl: string
  apiKey: string
}): AgentApi {
  const apiUrl = input.apiUrl.replace(/\/+$/, "")

  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    options: { method?: string; body?: unknown } = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${input.apiKey}`,
    }
    let body: string | undefined
    if (options.body !== undefined) {
      headers["content-type"] = "application/json"
      body = JSON.stringify(options.body)
    }

    const response = await fetch(`${apiUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...headers,
      },
      body,
    })
    const payload = await response.json().catch(() => null)

    if (!response.ok) {
      const message =
        payload &&
        typeof payload === "object" &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : `Gentic API request failed with ${response.status}`
      throw new Error(message)
    }

    return schema.parse(payload)
  }

  return {
    async claimNextQueuedIssue() {
      const data = await request(
        "/agent/issues/claim",
        claimIssueResponseSchema,
        { method: "POST" }
      )
      return data.issue
    },
    async setRunState(issueId, fields) {
      await request(
        `/agent/issues/${encodeURIComponent(issueId)}/run-state`,
        okResponseSchema,
        {
          method: "PATCH",
          body: fields,
        }
      )
    },
    async finishRun(issueId, fields) {
      const data = await request(
        `/agent/issues/${encodeURIComponent(issueId)}/run-state`,
        finishRunResponseSchema,
        {
          method: "PATCH",
          body: { ...fields, finish_if_no_pending: true },
        }
      )
      return { finished: data.finished, status: data.status ?? fields.status }
    },
    async insertMessage(issueId, message) {
      const data = await request(
        `/agent/issues/${encodeURIComponent(issueId)}/messages`,
        insertMessageResponseSchema,
        {
          method: "POST",
          body: message,
        }
      )
      return data.id
    },
    async fetchPendingUserMessages(issueId) {
      const data = await request(
        `/agent/issues/${encodeURIComponent(issueId)}/messages`,
        pendingUserMessagesResponseSchema
      )
      return data.messages
    },
    async ackUserMessages(issueId, runId, messageIds) {
      if (messageIds.length === 0) {
        return
      }
      const body: AckMessagesInput = { run_id: runId, message_ids: messageIds }
      await request(
        `/agent/issues/${encodeURIComponent(issueId)}/messages`,
        okResponseSchema,
        {
          method: "PATCH",
          body,
        }
      )
    },
    async fetchAttachments(issueId, messageId) {
      const params = new URLSearchParams({ message_id: messageId })
      const data = await request(
        `/agent/issues/${encodeURIComponent(issueId)}/attachments?${params}`,
        attachmentsResponseSchema
      )
      return data.attachments
    },
    async fetchRealtimeToken() {
      return request("/agent/realtime/token", realtimeTokenResponseSchema, {
        method: "POST",
      })
    },
  }
}
