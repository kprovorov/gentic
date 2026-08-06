import { z } from "zod"

import {
  chatEventPayloadSchema,
  chatEventStatusSchema,
  chatEventTypeSchema,
  chatMessageKindSchema,
  chatMessageStatusSchema,
} from "./chat-events.js"
import {
  agentProviderSchema,
  issueModelSchema,
  issueStatusSchema,
} from "./issues.js"
import { realtimeRunStateStatusSchema } from "./realtime.js"

export type { RealtimeRunStateStatus } from "./realtime.js"

export const claimIssueInputSchema = z.object({}).passthrough()

export type ClaimIssueInput = z.infer<typeof claimIssueInputSchema>

export const claimedIssueSchema = z.object({
  id: z.string().uuid(),
  activeRunId: z.string().uuid(),
  code: z.string(),
  title: z.string().nullable(),
  agentProvider: agentProviderSchema,
  issueModel: issueModelSchema,
  repo: z.string(),
  setupScript: z.string().nullable(),
  sessionId: z.string().nullable(),
  prUrl: z.string().nullable(),
  createPrAutomatically: z.boolean(),
  hasUnpublishedAgentChanges: z.boolean(),
})

export type ClaimedIssue = z.infer<typeof claimedIssueSchema>

export const claimIssueResponseSchema = z.object({
  issue: claimedIssueSchema.nullable(),
})

const runStateFieldsBaseSchema = z
  .object({
    active_run_id: z.string().uuid(),
    status: realtimeRunStateStatusSchema.optional(),
    session_id: z.string().nullable().optional(),
    run_error: z.string().nullable().optional(),
    run_started_at: z.string().datetime().nullable().optional(),
    run_finished_at: z.string().datetime().nullable().optional(),
    usage_limit_reset_at: z.string().datetime().nullable().optional(),
    pr_url: z.string().url().nullable().optional(),
  })
  .strict()

export const runStateFieldsSchema = runStateFieldsBaseSchema.refine((value) =>
  Object.keys(value).some((key) => key !== "active_run_id")
)

export type RunStateFields = z.infer<typeof runStateFieldsSchema>

export const finishRunFieldsSchema = runStateFieldsBaseSchema
  .extend({
    active_run_id: z.string().uuid(),
    status: realtimeRunStateStatusSchema.extract([
      "ready-for-review",
      "waiting-for-input",
    ]),
    run_finished_at: z.string().datetime(),
  })
  .strict()

export type FinishRunFields = z.infer<typeof finishRunFieldsSchema>

export const okResponseSchema = z.object({
  ok: z.literal(true),
})

export const finishRunResponseSchema = z.object({
  finished: z.boolean(),
  status: issueStatusSchema.optional(),
})

export const ackMessagesInputSchema = z.object({
  run_id: z.string().uuid(),
  message_ids: z.array(z.string().uuid()).min(1),
})

export type AckMessagesInput = z.infer<typeof ackMessagesInputSchema>

export const userMessageSchema = z.object({
  id: z.string().uuid(),
  content: z.string().nullable(),
  created_at: z.string(),
  seq: z.number(),
})

export type UserMessage = z.infer<typeof userMessageSchema>

export const pendingUserMessagesResponseSchema = z.object({
  messages: z.array(userMessageSchema),
})

export const realtimeTokenResponseSchema = z.object({
  url: z.string().url(),
  apiKey: z.string(),
  token: z.string(),
  expiresAt: z.string(),
})

export type RealtimeTokenResponse = z.infer<typeof realtimeTokenResponseSchema>

export const realtimeTokenInputSchema = z
  .object({
    issue_id: z.string().uuid(),
    active_run_id: z.string().uuid(),
  })
  .strict()

export type RealtimeTokenInput = z.infer<typeof realtimeTokenInputSchema>

export const insertMessageInputShape = {
  id: z.string().uuid(),
  role: z.enum(["assistant", "system"]),
  kind: chatMessageKindSchema.optional(),
  content: z.string(),
  status: chatMessageStatusSchema.optional(),
  author_type: z.enum(["agent", "gentic"]).optional(),
  generated_action: z.enum(["create_pr"]).nullable().optional(),
  event_id: z.string().nullable().optional(),
  run_id: z.string().uuid(),
  event_type: chatEventTypeSchema.nullable().optional(),
  event_status: chatEventStatusSchema.nullable().optional(),
  event_ts: z.string().datetime().nullable().optional(),
  event_seq: z.number().int().positive().nullable().optional(),
  tool_call_id: z.string().nullable().optional(),
  payload: chatEventPayloadSchema.nullable().optional(),
}

export function requireGenticGeneratedActionAuthor<
  T extends {
    author_type?: "agent" | "gentic"
    generated_action?: "create_pr" | null
  },
>(value: T): boolean {
  return (
    value.generated_action === undefined ||
    value.generated_action === null ||
    value.author_type === "gentic"
  )
}

export const insertMessageInputSchema = z
  .object(insertMessageInputShape)
  .refine(requireGenticGeneratedActionAuthor, {
    message: "Generated actions must be Gentic-authored",
    path: ["author_type"],
  })

export type InsertMessageInput = z.infer<typeof insertMessageInputSchema>

export const insertMessageResponseSchema = z.object({
  id: z.string().uuid(),
})

export const automaticPrRequestSchema = z.object({
  id: z.string().uuid(),
  issue_id: z.string().uuid(),
  run_id: z.string().uuid(),
  requested_by_message_id: z.string().uuid().nullable(),
  create_pr_automatically_snapshot: z.boolean(),
  status: z.enum(["pending", "claimed", "completed", "failed", "skipped"]),
  error: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type AutomaticPrRequest = z.infer<typeof automaticPrRequestSchema>
export type AutomaticPrRequestStatus = AutomaticPrRequest["status"]

export const recordUnpublishedChangesInputSchema = z.object({
  active_run_id: z.string().uuid(),
  has_unpublished_agent_changes: z.boolean(),
})

export type RecordUnpublishedChangesInput = z.infer<
  typeof recordUnpublishedChangesInputSchema
>

export const requestAutomaticPrPublishInputSchema = z.object({
  active_run_id: z.string().uuid(),
})

export type RequestAutomaticPrPublishInput = z.infer<
  typeof requestAutomaticPrPublishInputSchema
>

// The full issue context a worker needs to keep acting on the same session
// without an extra round trip (e.g. it must not fall back to a
// waiting-for-input transition just to learn the issue's code/title/PR
// state) is echoed back alongside the created (or already-existing, on a
// retried/duplicate call) request and message.
export const automaticPrPublishResponseSchema = z.object({
  requestId: z.string().uuid(),
  messageId: z.string().uuid(),
  created: z.boolean(),
  status: automaticPrRequestSchema.shape.status,
  issue: z.object({
    id: z.string().uuid(),
    code: z.string(),
    title: z.string().nullable(),
    activeRunId: z.string().uuid(),
    createPrAutomatically: z.boolean(),
    hasUnpublishedAgentChanges: z.boolean(),
  }),
})

export type AutomaticPrPublishResponse = z.infer<
  typeof automaticPrPublishResponseSchema
>

export const attachmentSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  contentType: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  url: z.string().url(),
})

export type Attachment = z.infer<typeof attachmentSchema>

export const attachmentsResponseSchema = z.object({
  attachments: z.array(attachmentSchema),
})
