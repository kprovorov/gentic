import {
  attachmentsResponseSchema,
  automaticPrPublishResponseSchema,
  claimIssueInputSchema,
  claimIssueResponseSchema,
  claimReviewRunInputSchema,
  claimReviewRunResponseSchema,
  completeReviewRunResponseSchema,
  failReviewRunResponseSchema,
  finishRunResponseSchema,
  insertMessageResponseSchema,
  okResponseSchema,
  pendingUserMessagesResponseSchema,
  realtimeTokenResponseSchema,
  reviewRunContextResponseSchema,
  type AckMessagesInput,
  type Attachment,
  type AutomaticPrPublishResponse,
  type ClaimedIssue,
  type ClaimedReviewRun,
  type CompleteReviewRunInput,
  type CompleteReviewRunResponse,
  type FinishRunFields,
  type InsertMessageInput,
  type RecordUnpublishedChangesInput,
  type RealtimeTokenResponse,
  type ReviewRunContext,
  type ReviewRunLogInput,
  type RunStateFields,
  type UserMessage,
} from "@gentic/validators/agent"
import type { IssueStatus } from "@gentic/validators/issues"
import {
  claimHostSkillInstallResponseSchema,
  type ReportHostSkillInstallResultInput,
  type HostSkillInstallCommand,
} from "@gentic/validators/skills"
import {
  hostControlResponseSchema,
  type HostControlResponse,
  type HostHeartbeatTelemetry,
} from "@gentic/validators/hosts"
import type { z } from "zod"

export type {
  AckMessagesInput,
  Attachment,
  AutomaticPrPublishResponse,
  ClaimedIssue,
  ClaimedReviewRun,
  CompleteReviewRunInput,
  CompleteReviewRunResponse,
  FinishRunFields,
  InsertMessageInput,
  RecordUnpublishedChangesInput,
  RealtimeRunStateStatus,
  RealtimeTokenResponse,
  ReviewRunContext,
  ReviewRunLogInput,
  RunStateFields,
  UserMessage,
} from "@gentic/validators/agent"

export type FinishRunResult = {
  finished: boolean
  status: IssueStatus
}

export interface AgentApi {
  claimNextQueuedIssue(): Promise<ClaimedIssue | null>
  claimReviewRun(): Promise<ClaimedReviewRun | null>
  sendReviewRunHeartbeat(reviewRunId: string): Promise<void>
  failReviewRun(
    reviewRunId: string,
    input: { error: string }
  ): Promise<{ retried: boolean }>
  completeReviewRun(
    reviewRunId: string,
    input: CompleteReviewRunInput
  ): Promise<CompleteReviewRunResponse>
  fetchReviewRunContext(reviewRunId: string): Promise<ReviewRunContext>
  fetchReviewRunRealtimeToken(
    reviewRunId: string
  ): Promise<RealtimeTokenResponse>
  appendReviewRunLog(
    reviewRunId: string,
    input: ReviewRunLogInput
  ): Promise<void>
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
  sendHeartbeat(telemetry: HostHeartbeatTelemetry): Promise<void>
  markOffline(): Promise<void>
  fetchHostControl(): Promise<HostControlResponse>
  /** Accepts this host's pending skill install, if it has one. */
  claimSkillInstall(): Promise<HostSkillInstallCommand | null>
  reportSkillInstall(
    installId: string,
    result: ReportHostSkillInstallResultInput
  ): Promise<void>
}

export function createAgentApi(input: {
  apiUrl: string
  apiKey: string
}): AgentApi {
  const apiUrl = input.apiUrl.replace(/\/+$/, "")
  const claimInput = claimIssueInputSchema.parse({})
  const claimReviewRunInput = claimReviewRunInputSchema.parse({})

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
    async claimReviewRun() {
      const data = await request(
        "/agent/review-runs/claim",
        claimReviewRunResponseSchema,
        { method: "POST", body: claimReviewRunInput }
      )
      return data.reviewRun
    },
    async sendReviewRunHeartbeat(reviewRunId) {
      await request(
        `/agent/review-runs/${encodeURIComponent(reviewRunId)}/heartbeat`,
        okResponseSchema,
        { method: "PATCH", body: {} }
      )
    },
    async failReviewRun(reviewRunId, reviewInput) {
      return request(
        `/agent/review-runs/${encodeURIComponent(reviewRunId)}/fail`,
        failReviewRunResponseSchema,
        { method: "PATCH", body: reviewInput }
      )
    },
    async completeReviewRun(reviewRunId, completeInput) {
      return request(
        `/agent/review-runs/${encodeURIComponent(reviewRunId)}/complete`,
        completeReviewRunResponseSchema,
        { method: "PATCH", body: completeInput }
      )
    },
    async fetchReviewRunContext(reviewRunId) {
      return request(
        `/agent/review-runs/${encodeURIComponent(reviewRunId)}/context`,
        reviewRunContextResponseSchema
      )
    },
    async fetchReviewRunRealtimeToken(reviewRunId) {
      return request("/agent/realtime/token", realtimeTokenResponseSchema, {
        method: "POST",
        body: { review_run_id: reviewRunId },
      })
    },
    async appendReviewRunLog(reviewRunId, logInput) {
      await request(
        `/agent/review-runs/${encodeURIComponent(reviewRunId)}/logs`,
        okResponseSchema,
        { method: "POST", body: logInput }
      )
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
      await request("/agent/host/heartbeat", okResponseSchema, {
        method: "PATCH",
        body: telemetry,
      })
    },
    async markOffline() {
      await request("/agent/host/heartbeat", okResponseSchema, {
        method: "DELETE",
        body: {},
      })
    },
    async fetchHostControl() {
      return request("/agent/host/control", hostControlResponseSchema)
    },
    async claimSkillInstall() {
      const data = await request(
        "/agent/host/skill-installs",
        claimHostSkillInstallResponseSchema,
        { method: "POST", body: {} }
      )
      return data.command
    },
    async reportSkillInstall(installId, result) {
      await request(
        `/agent/host/skill-installs/${encodeURIComponent(installId)}`,
        okResponseSchema,
        { method: "PATCH", body: result }
      )
    },
  }
}
