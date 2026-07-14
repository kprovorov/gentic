import { z } from "zod"

import { agentProviderSchema } from "./issues.js"
import { realtimeRunStateStatusSchema } from "./realtime.js"

export const claimedIssueSchema = z.object({
  id: z.string().uuid(),
  agentProvider: agentProviderSchema,
  repo: z.string(),
  setupScript: z.string().nullable(),
  sessionId: z.string().nullable(),
  runFinishedAt: z.string().nullable(),
  prUrl: z.string().nullable(),
})

export type ClaimedIssue = z.infer<typeof claimedIssueSchema>

export const claimIssueResponseSchema = z.object({
  issue: claimedIssueSchema.nullable(),
})

export const runStateFieldsSchema = z
  .object({
    status: realtimeRunStateStatusSchema.optional(),
    session_id: z.string().nullable().optional(),
    run_error: z.string().nullable().optional(),
    run_started_at: z.string().datetime().nullable().optional(),
    run_finished_at: z.string().datetime().nullable().optional(),
    usage_limit_reset_at: z.string().datetime().nullable().optional(),
    pr_url: z.string().url().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0)

export type RunStateFields = z.infer<typeof runStateFieldsSchema>

export const okResponseSchema = z.object({
  ok: z.literal(true),
})

export const userMessageSchema = z.object({
  id: z.string().uuid(),
  content: z.string().nullable(),
  created_at: z.string(),
})

export type UserMessage = z.infer<typeof userMessageSchema>

export const userMessagesResponseSchema = z.object({
  messages: z.array(userMessageSchema),
})

export const realtimeTokenResponseSchema = z.object({
  url: z.string().url(),
  apiKey: z.string(),
  token: z.string(),
  expiresAt: z.string(),
})

export type RealtimeTokenResponse = z.infer<typeof realtimeTokenResponseSchema>

export const insertMessageInputSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["assistant", "system"]),
  kind: z.enum(["text", "tool", "thinking"]).optional(),
  content: z.string(),
  status: z.enum(["complete", "error"]).optional(),
})

export type InsertMessageInput = z.infer<typeof insertMessageInputSchema>

export const insertMessageResponseSchema = z.object({
  id: z.string().uuid(),
})

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
