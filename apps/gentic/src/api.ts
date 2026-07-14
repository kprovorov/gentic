import {
  attachmentsResponseSchema,
  claimIssueResponseSchema,
  insertMessageResponseSchema,
  okResponseSchema,
  realtimeTokenResponseSchema,
  userMessagesResponseSchema,
  type Attachment,
  type ClaimedIssue,
  type InsertMessageInput,
  type RealtimeTokenResponse,
  type RunStateFields,
  type UserMessage,
} from "@gentic/validators/agent"
import type { z } from "zod"

export type {
  Attachment,
  ClaimedIssue,
  InsertMessageInput,
  RealtimeTokenResponse,
  RunStateFields,
  UserMessage,
} from "@gentic/validators/agent"

export interface AgentApi {
  claimNextQueuedIssue(): Promise<ClaimedIssue | null>
  setRunState(issueId: string, fields: RunStateFields): Promise<void>
  insertMessage(issueId: string, message: InsertMessageInput): Promise<string>
  fetchUserMessagesAfter(issueId: string, cursor: string): Promise<UserMessage[]>
  fetchAttachments(issueId: string): Promise<Attachment[]>
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
    async fetchUserMessagesAfter(issueId, cursor) {
      const params = new URLSearchParams({ after: cursor })
      const data = await request(
        `/agent/issues/${encodeURIComponent(issueId)}/messages?${params}`,
        userMessagesResponseSchema
      )
      return data.messages
    },
    async fetchAttachments(issueId) {
      const data = await request(
        `/agent/issues/${encodeURIComponent(issueId)}/attachments`,
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
