import { z } from "zod"

import {
  chatEventPayloadSchema,
  chatEventStatusSchema,
  chatEventTypeSchema,
  chatMessageKindSchema,
  chatMessageStatusSchema,
} from "./chat-events.js"
import {
  issuePrioritySchema,
  issueStatusSchema,
  type IssueStatus,
} from "./issues.js"

// Event names for the private `issue:{id}` Realtime Broadcast channel. See
// docs/realtime-transport.md for the full protocol.
export const REALTIME_MESSAGE_EVENT = "message"
export const REALTIME_RUN_STATE_EVENT = "run_state"
export const REALTIME_USER_MESSAGE_EVENT = "user_message"

export function issueRealtimeTopic(issueId: string): string {
  return `issue:${issueId}`
}

export const messageAuthorTypeSchema = z.enum(["user", "agent", "gentic"])
export const generatedMessageActionSchema = z.enum(["create_pr"])

export const realtimeMessageRoleSchema = z.enum(["assistant", "system"])
export const chatMessageRoleSchema = z.enum(["user", "assistant", "system"])
export const realtimeMessageKindSchema = chatMessageKindSchema
export const realtimeMessageStatusSchema = chatMessageStatusSchema

export function requireGenticGeneratedMessageAction<
  T extends {
    role?: "user" | "assistant" | "system"
    author_type?: "user" | "agent" | "gentic"
    generated_action?: "create_pr" | null
  },
>(value: T): boolean {
  return (
    value.generated_action === undefined ||
    value.generated_action === null ||
    (value.role === "user" && value.author_type === "user") ||
    value.author_type === "gentic"
  )
}

export const chatMessageSchema = z
  .object({
    id: z.string(),
    role: chatMessageRoleSchema,
    kind: realtimeMessageKindSchema,
    content: z.string().nullable(),
    status: realtimeMessageStatusSchema,
    author_type: messageAuthorTypeSchema.optional(),
    generated_action: generatedMessageActionSchema.nullable().optional(),
    created_at: z.string(),
    event_id: z.string().min(1).nullable().optional(),
    run_id: z.string().min(1).nullable().optional(),
    event_type: chatEventTypeSchema.nullable().optional(),
    event_status: chatEventStatusSchema.nullable().optional(),
    event_ts: z.string().datetime({ offset: true }).nullable().optional(),
    event_seq: z.number().int().positive().nullable().optional(),
    tool_call_id: z.string().min(1).nullable().optional(),
    payload: chatEventPayloadSchema.nullable().optional(),
  })
  .refine(requireGenticGeneratedMessageAction, {
    message: "Generated actions must be Gentic-authored",
    path: ["author_type"],
  })

export type ChatMessageContract = z.infer<typeof chatMessageSchema>

// Worker -> browser: full-snapshot upsert of one transcript message.
export const messageEventSchema = z
  .object({
    id: z.string().uuid(),
    seq: z.number().int().positive(),
    role: realtimeMessageRoleSchema,
    kind: realtimeMessageKindSchema,
    content: z.string(),
    status: realtimeMessageStatusSchema,
    author_type: messageAuthorTypeSchema
      .extract(["agent", "gentic"])
      .default("agent"),
    generated_action: generatedMessageActionSchema.nullable().optional(),
    event_id: z.string().min(1).nullable().optional(),
    run_id: z.string().min(1).nullable().optional(),
    event_type: chatEventTypeSchema.nullable().optional(),
    event_status: chatEventStatusSchema.nullable().optional(),
    event_ts: z.string().datetime({ offset: true }).nullable().optional(),
    event_seq: z.number().int().positive().nullable().optional(),
    tool_call_id: z.string().min(1).nullable().optional(),
    payload: chatEventPayloadSchema.nullable().optional(),
    ts: z.string(),
  })
  .refine(requireGenticGeneratedMessageAction, {
    message: "Generated actions must be Gentic-authored",
    path: ["author_type"],
  })

export type MessageEvent = {
  id: string
  seq: number
  role: z.infer<typeof realtimeMessageRoleSchema>
  kind: z.infer<typeof realtimeMessageKindSchema>
  content: string
  status: z.infer<typeof realtimeMessageStatusSchema>
  author_type?: "agent" | "gentic"
  generated_action?: "create_pr" | null
  event_id?: string | null
  run_id?: string | null
  event_type?: z.infer<typeof chatEventTypeSchema> | null
  event_status?: z.infer<typeof chatEventStatusSchema> | null
  event_ts?: string | null
  event_seq?: number | null
  tool_call_id?: string | null
  payload?: z.infer<typeof chatEventPayloadSchema> | null
  ts: string
}

export const realtimeRunStateStatusSchema = issueStatusSchema.extract([
  "in-progress",
  "held",
  "run-failed",
  "ready-for-review",
  "waiting-for-input",
  "testing",
])

export type RealtimeRunStateStatus = z.infer<
  typeof realtimeRunStateStatusSchema
>

// Worker -> browser: mirror of the run-state PATCH, for instant UI updates.
export const runStateEventSchema = z.object({
  status: realtimeRunStateStatusSchema,
  usage_limit_reset_at: z.string().nullable(),
  run_error: z.string().nullable(),
  ts: z.string(),
})

export type RunStateEvent = {
  status: z.infer<typeof realtimeRunStateStatusSchema>
  usage_limit_reset_at: string | null
  run_error: string | null
  ts: string
}

export const issueRunStateRowSchema = z.object({
  status: issueStatusSchema,
  usage_limit_reset_at: z.string().nullable(),
})

export type IssueRunStateRow = {
  status: IssueStatus
  usage_limit_reset_at: string | null
}

export const issuePullRequestSchema = z.object({
  id: z.string().uuid(),
  issue_id: z.string().uuid(),
  url: z.string(),
  created_at: z.string(),
  state: z
    .enum(["draft", "open", "merged", "closed", "queued"])
    .nullable()
    .transform((state) => state ?? undefined),
})

export type IssuePullRequestContract = z.infer<typeof issuePullRequestSchema>

export const issuePriorityChangedPayloadSchema = z.object({
  from: issuePrioritySchema,
  to: issuePrioritySchema,
})

export const labelSnapshotSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  color: z.string(),
})

export type LabelSnapshot = z.infer<typeof labelSnapshotSchema>

export const issueLabelsChangedPayloadSchema = z.object({
  added: z.array(labelSnapshotSchema),
  removed: z.array(labelSnapshotSchema),
})

export type IssueLabelsChangedPayload = z.infer<
  typeof issueLabelsChangedPayloadSchema
>

const knownIssueEventTypeSchema = z.enum(["priority_changed", "labels_changed"])

const priorityChangedIssueEventSchema = z.object({
  id: z.string().uuid(),
  issue_id: z.string().uuid(),
  type: z.literal("priority_changed"),
  payload: issuePriorityChangedPayloadSchema,
  created_at: z.string(),
})

const labelsChangedIssueEventSchema = z.object({
  id: z.string().uuid(),
  issue_id: z.string().uuid(),
  type: z.literal("labels_changed"),
  payload: issueLabelsChangedPayloadSchema,
  created_at: z.string(),
})

const genericIssueEventSchema = z.object({
  id: z.string().uuid(),
  issue_id: z.string().uuid(),
  type: z.string().refine((type) => !knownIssueEventTypeSchema.safeParse(type).success),
  payload: chatEventPayloadSchema,
  created_at: z.string(),
})

export const issueEventSchema = z.union([
  priorityChangedIssueEventSchema,
  labelsChangedIssueEventSchema,
  genericIssueEventSchema,
])

export type IssueEventContract = z.infer<typeof issueEventSchema>

export const deletedRowSchema = z.object({
  id: z.string().uuid(),
})

export type DeletedRow = z.infer<typeof deletedRowSchema>

// Browser -> worker: wake-up signal for a persisted follow-up message. Workers
// fetch durable messages from the database and must not treat Broadcast as the
// delivery source of truth.
export const userMessageEventSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  created_at: z.string(),
})

export type UserMessageEvent = z.infer<typeof userMessageEventSchema>
