import {
  attachmentsResponseSchema,
  automaticPrPublishResponseSchema,
  claimIssueInputSchema,
  claimIssueResponseSchema,
  finishRunResponseSchema,
  insertMessageResponseSchema,
  okResponseSchema,
  pendingUserMessagesResponseSchema,
  realtimeTokenResponseSchema,
  type AckMessagesInput,
  type Attachment,
  type AutomaticPrPublishResponse,
  type ClaimedIssue,
  type FinishRunFields,
  type InsertMessageInput,
  type RecordUnpublishedChangesInput,
  type RealtimeRunStateStatus,
  type RealtimeTokenResponse,
  type RunStateFields,
  type UserMessage,
} from "@gentic/validators/agent"
import {
  workerControlResponseSchema,
  type WorkerControlResponse,
  type WorkerHeartbeatTelemetry,
} from "@gentic/validators/workers"
import type { z } from "zod"

export type {
  AckMessagesInput,
  Attachment,
  AutomaticPrPublishResponse,
  ClaimedIssue,
  FinishRunFields,
  InsertMessageInput,
  RecordUnpublishedChangesInput,
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
  setRunState(
    issueId: string,
    activeRunId: string,
    fields: Omit<RunStateFields, "active_run_id">
  ): Promise<void>
  finishRun(issueId: string, fields: FinishRunFields): Promise<FinishRunResult>
  insertMessage(issueId: string, message: InsertMessageInput): Promise<string>
  fetchPendingUserMessages(
    issueId: string,
    activeRunId: string
  ): Promise<UserMessage[]>
  ackUserMessages(
    issueId: string,
    runId: string,
    messageIds: string[]
  ): Promise<void>
  recordUnpublishedAgentChanges(
    issueId: string,
    fields: RecordUnpublishedChangesInput
  ): Promise<void>
  requestAutomaticPrPublish(
    issueId: string,
    activeRunId: string
  ): Promise<AutomaticPrPublishResponse>
  /** `messageId: null` asks for the issue's own durable attachments. */
  fetchAttachments(
    issueId: string,
    activeRunId: string,
    messageId: string | null
  ): Promise<Attachment[]>
  fetchRealtimeToken(
    issueId: string,
    activeRunId: string
  ): Promise<RealtimeTokenResponse>
  sendHeartbeat(telemetry: WorkerHeartbeatTelemetry): Promise<void>
  markOffline(): Promise<void>
  fetchWorkerControl(): Promise<WorkerControlResponse>
}

export function createAgentApi(input: {
  apiUrl: string
  apiKey: string
}): AgentApi {
  const apiUrl = input.apiUrl.replace(/\/+$/, "")
  const claimInput = claimIssueInputSchema.parse({})

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
        { method: "POST", body: claimInput }
      )
      return data.issue
    },
    async setRunState(issueId, activeRunId, fields) {
      await request(
        `/agent/issues/${encodeURIComponent(issueId)}/run-state`,
        okResponseSchema,
        {
          method: "PATCH",
          body: { active_run_id: activeRunId, ...fields },
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
    async fetchPendingUserMessages(issueId, activeRunId) {
      const params = new URLSearchParams({ run_id: activeRunId })
      const data = await request(
        `/agent/issues/${encodeURIComponent(issueId)}/messages?${params}`,
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
    async recordUnpublishedAgentChanges(issueId, fields) {
      await request(
        `/agent/issues/${encodeURIComponent(issueId)}/unpublished-changes`,
        okResponseSchema,
        {
          method: "PATCH",
          body: fields,
        }
      )
    },
    async requestAutomaticPrPublish(issueId, activeRunId) {
      return request(
        `/agent/issues/${encodeURIComponent(issueId)}/automatic-pr-requests`,
        automaticPrPublishResponseSchema,
        {
          method: "POST",
          body: { active_run_id: activeRunId },
        }
      )
    },
    async fetchAttachments(issueId, activeRunId, messageId) {
      const params = new URLSearchParams({ run_id: activeRunId })
      if (messageId !== null) {
        params.set("message_id", messageId)
      }
      const data = await request(
        `/agent/issues/${encodeURIComponent(issueId)}/attachments?${params}`,
        attachmentsResponseSchema
      )
      return data.attachments
    },
    async fetchRealtimeToken(issueId, activeRunId) {
      return request("/agent/realtime/token", realtimeTokenResponseSchema, {
        method: "POST",
        body: { issue_id: issueId, active_run_id: activeRunId },
      })
    },
    async sendHeartbeat(telemetry) {
      await request("/agent/worker/heartbeat", okResponseSchema, {
        method: "PATCH",
        body: telemetry,
      })
    },
    async markOffline() {
      await request("/agent/worker/heartbeat", okResponseSchema, {
        method: "DELETE",
        body: {},
      })
    },
    async fetchWorkerControl() {
      return request("/agent/worker/control", workerControlResponseSchema)
    },
  }
}
