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

// The Review Run log sink (GEN-415) is a deliberately separate channel from
// Issue chat above — a reviewer's execution log must never be mistaken for,
// or mixed into, the implementation agent's transcript.
export function reviewRunRealtimeTopic(reviewRunId: string): string {
  return `review-run:${reviewRunId}`
}

// Broadcast payload for the Review Run log sink — deliberately a much
// smaller shape than `messageEventSchema` above (no tool-call/event-type/
// generated-action fields), since it mirrors the equally minimal
// `review_run_logs` table rather than the full chat-message contract.
export const reviewRunLogEventSchema = z.object({
  seq: z.number().int().positive(),
  role: z.enum(["assistant", "system"]),
  content: z.string(),
  ts: z.string(),
})

export type ReviewRunLogEvent = z.infer<typeof reviewRunLogEventSchema>

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

// Host -> browser: full-snapshot upsert of one transcript message.
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

// Host -> browser: mirror of the run-state PATCH, for instant UI updates.
export const runStateEventSchema = z
  .object({
    status: issueStatusSchema,
    usage_limit_reset_at: z.string().nullable(),
    run_error: z.string().nullable(),
    ts: z.string(),
  })
  .strict()

export type RunStateEvent = {
  status: IssueStatus
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
  // Kept in step with `@gentic/services/issues`' `IssuePullRequest` (GEN-419)
  // so a live realtime upsert never regresses the rail's review-state
  // display back to stale/missing CI or review data.
  head_sha: z.string().nullable(),
  ci_state: z.string(),
  review_decision: z.string(),
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

// The Automatic Review lifecycle engine (GEN-413/414/419, see ADR-0004) and
// its neighbors write these directly from SQL (see
// `packages/services/src/issues/events.ts`'s `IssueEventType` for the full,
// typed picture of every event type currently written). Payload shapes here
// mirror the exact `jsonb_build_object(...)` each RPC inserts.
export const reviewQueuedPayloadSchema = z.object({
  review_cycle_id: z.string().uuid(),
  review_run_id: z.string().uuid(),
  pull_request_id: z.string().uuid(),
  head_sha: z.string(),
  attempt_number: z.number().int().positive(),
})

export const reviewStartedPayloadSchema = z.object({
  review_run_id: z.string().uuid(),
  review_cycle_id: z.string().uuid(),
  pull_request_id: z.string().uuid(),
})

export const reviewApprovedPayloadSchema = z.object({
  review_attempt_id: z.string().uuid().nullable(),
  review_cycle_id: z.string().uuid(),
  pull_request_id: z.string().uuid(),
  attempt_number: z.number().int().positive().nullable(),
  source: z.enum(["automatic", "human_override"]),
})

export const reviewChangesRequestedPayloadSchema = z.object({
  review_attempt_id: z.string().uuid(),
  review_cycle_id: z.string().uuid(),
  pull_request_id: z.string().uuid(),
  attempt_number: z.number().int().positive(),
  verdict: z.enum(["changes_requested", "commented"]),
  findings_count: z.number().int().nonnegative(),
})

export const reviewFailedPayloadSchema = z.object({
  review_run_id: z.string().uuid(),
  review_cycle_id: z.string().uuid(),
  pull_request_id: z.string().uuid(),
  error: z.string(),
  retried: z.boolean(),
})

export const reviewSupersededPayloadSchema = z.object({
  review_cycle_id: z.string().uuid(),
  pull_request_id: z.string().uuid(),
  reason: z.enum(["new_head_sha", "human_review"]),
})

export const reviewFixDeliveredPayloadSchema = z.object({
  review_attempt_id: z.string().uuid(),
  message_id: z.string().uuid(),
})

export const implementationOwnershipResetPayloadSchema = z.object({
  generation: z.number().int().positive(),
  origin: z.literal("fresh_implementation"),
})

const knownIssueEventTypeSchema = z.enum([
  "priority_changed",
  "labels_changed",
  "review_queued",
  "review_started",
  "review_approved",
  "review_changes_requested",
  "review_failed",
  "review_superseded",
  "review_fix_delivered",
  "implementation_ownership_reset",
])

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

function issueEventOfType<Type extends string, Payload extends z.ZodTypeAny>(
  type: Type,
  payloadSchema: Payload
) {
  return z.object({
    id: z.string().uuid(),
    issue_id: z.string().uuid(),
    type: z.literal(type),
    payload: payloadSchema,
    created_at: z.string(),
  })
}

const reviewQueuedIssueEventSchema = issueEventOfType(
  "review_queued",
  reviewQueuedPayloadSchema
)
const reviewStartedIssueEventSchema = issueEventOfType(
  "review_started",
  reviewStartedPayloadSchema
)
const reviewApprovedIssueEventSchema = issueEventOfType(
  "review_approved",
  reviewApprovedPayloadSchema
)
const reviewChangesRequestedIssueEventSchema = issueEventOfType(
  "review_changes_requested",
  reviewChangesRequestedPayloadSchema
)
const reviewFailedIssueEventSchema = issueEventOfType(
  "review_failed",
  reviewFailedPayloadSchema
)
const reviewSupersededIssueEventSchema = issueEventOfType(
  "review_superseded",
  reviewSupersededPayloadSchema
)
const reviewFixDeliveredIssueEventSchema = issueEventOfType(
  "review_fix_delivered",
  reviewFixDeliveredPayloadSchema
)
const implementationOwnershipResetIssueEventSchema = issueEventOfType(
  "implementation_ownership_reset",
  implementationOwnershipResetPayloadSchema
)

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
  reviewQueuedIssueEventSchema,
  reviewStartedIssueEventSchema,
  reviewApprovedIssueEventSchema,
  reviewChangesRequestedIssueEventSchema,
  reviewFailedIssueEventSchema,
  reviewSupersededIssueEventSchema,
  reviewFixDeliveredIssueEventSchema,
  implementationOwnershipResetIssueEventSchema,
  genericIssueEventSchema,
])

export type IssueEventContract = z.infer<typeof issueEventSchema>

export const deletedRowSchema = z.object({
  id: z.string().uuid(),
})

export type DeletedRow = z.infer<typeof deletedRowSchema>

// Browser -> host: wake-up signal for a persisted follow-up message. Hosts
// fetch durable messages from the database and must not treat Broadcast as the
// delivery source of truth.
export const userMessageEventSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  created_at: z.string(),
})

export type UserMessageEvent = z.infer<typeof userMessageEventSchema>
