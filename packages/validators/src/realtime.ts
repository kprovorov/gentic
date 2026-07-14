import { z } from "zod"

import { issueStatusSchema } from "./issues"

// Event names for the private `issue:{id}` Realtime Broadcast channel. See
// docs/realtime-transport.md for the full protocol.
export const REALTIME_MESSAGE_EVENT = "message"
export const REALTIME_RUN_STATE_EVENT = "run_state"
export const REALTIME_USER_MESSAGE_EVENT = "user_message"

export function issueRealtimeTopic(issueId: string): string {
  return `issue:${issueId}`
}

export const realtimeMessageRoleSchema = z.enum(["assistant", "system"])
export const realtimeMessageKindSchema = z.enum(["text", "thinking", "tool"])
export const realtimeMessageStatusSchema = z.enum([
  "streaming",
  "complete",
  "error",
])

// Worker -> browser: full-snapshot upsert of one transcript message.
export const messageEventSchema = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  seq: z.number().int().positive(),
  role: realtimeMessageRoleSchema,
  kind: realtimeMessageKindSchema,
  content: z.string(),
  status: realtimeMessageStatusSchema,
  ts: z.string(),
})

export type MessageEvent = z.infer<typeof messageEventSchema>

export const realtimeRunStateStatusSchema = issueStatusSchema.extract([
  "in-progress",
  "held",
  "run-failed",
  "ready-for-review",
  "waiting-for-input",
])

// Worker -> browser: mirror of the run-state PATCH, for instant UI updates.
export const runStateEventSchema = z.object({
  run_id: z.string().uuid(),
  status: realtimeRunStateStatusSchema,
  pr_url: z.string().url().nullable(),
  usage_limit_reset_at: z.string().nullable(),
  run_error: z.string().nullable(),
  ts: z.string(),
})

export type RunStateEvent = z.infer<typeof runStateEventSchema>

// Browser -> worker: a follow-up message, keyed by the `messages` row id so
// the worker can dedupe it against its REST-fetched backlog.
export const userMessageEventSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  created_at: z.string(),
})

export type UserMessageEvent = z.infer<typeof userMessageEventSchema>
