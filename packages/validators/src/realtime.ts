import { z } from "zod"

import { issueStatusSchema, type IssueStatus } from "./issues.js"

// Event names for the private `issue:{id}` Realtime Broadcast channel. See
// docs/realtime-transport.md for the full protocol.
export const REALTIME_MESSAGE_EVENT = "message"
export const REALTIME_RUN_STATE_EVENT = "run_state"
export const REALTIME_USER_MESSAGE_EVENT = "user_message"

export function issueRealtimeTopic(issueId: string): string {
  return `issue:${issueId}`
}

export const realtimeMessageRoleSchema = z.enum(["assistant", "system"])
export const chatMessageRoleSchema = z.enum(["user", "assistant", "system"])
export const realtimeMessageKindSchema = z.enum(["text", "thinking", "tool"])
export const realtimeMessageStatusSchema = z.enum([
  "streaming",
  "complete",
  "error",
])

export const chatMessageSchema = z.object({
  id: z.string(),
  role: chatMessageRoleSchema,
  kind: realtimeMessageKindSchema,
  content: z.string().nullable(),
  status: realtimeMessageStatusSchema,
  created_at: z.string(),
})

export type ChatMessageContract = z.infer<typeof chatMessageSchema>

// Worker -> browser: full-snapshot upsert of one transcript message.
export const messageEventSchema = z.object({
  id: z.string().uuid(),
  seq: z.number().int().positive(),
  role: realtimeMessageRoleSchema,
  kind: realtimeMessageKindSchema,
  content: z.string(),
  status: realtimeMessageStatusSchema,
  ts: z.string(),
})

export type MessageEvent = {
  id: string
  seq: number
  role: z.infer<typeof realtimeMessageRoleSchema>
  kind: z.infer<typeof realtimeMessageKindSchema>
  content: string
  status: z.infer<typeof realtimeMessageStatusSchema>
  ts: string
}

export const realtimeRunStateStatusSchema = issueStatusSchema.extract([
  "in-progress",
  "held",
  "run-failed",
  "ready-for-review",
  "waiting-for-input",
])

// Worker -> browser: mirror of the run-state PATCH, for instant UI updates.
export const runStateEventSchema = z.object({
  status: realtimeRunStateStatusSchema,
  pr_url: z.string().url().nullable(),
  usage_limit_reset_at: z.string().nullable(),
  run_error: z.string().nullable(),
  ts: z.string(),
})

export type RunStateEvent = {
  status: z.infer<typeof realtimeRunStateStatusSchema>
  pr_url: string | null
  usage_limit_reset_at: string | null
  run_error: string | null
  ts: string
}

export const issueRunStateRowSchema = z.object({
  status: issueStatusSchema,
  usage_limit_reset_at: z.string().nullable(),
  pr_url: z.string().nullable(),
})

export type IssueRunStateRow = {
  status: IssueStatus
  usage_limit_reset_at: string | null
  pr_url: string | null
}

export const issuePullRequestSchema = z.object({
  id: z.string().uuid(),
  issue_id: z.string().uuid(),
  url: z.string(),
  created_at: z.string(),
})

export type IssuePullRequestContract = z.infer<typeof issuePullRequestSchema>

export const deletedRowSchema = z.object({
  id: z.string().uuid(),
})

export type DeletedRow = z.infer<typeof deletedRowSchema>

// Browser -> worker: a follow-up message, keyed by the `messages` row id so
// the worker can dedupe it against its REST-fetched backlog.
export const userMessageEventSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  created_at: z.string(),
})

export type UserMessageEvent = z.infer<typeof userMessageEventSchema>
