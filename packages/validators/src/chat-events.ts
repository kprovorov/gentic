import { z } from "zod"

export const chatEventTypeSchema = z.enum([
  "text",
  "thought",
  "tool_call",
  "plan",
  "mode",
  "available_commands",
])

export const chatEventStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "failed",
  "removed",
])

export const chatMessageStatusSchema = z.enum([
  "streaming",
  "complete",
  "error",
])

export const chatMessageKindSchema = z.enum([
  "text",
  "thinking",
  "tool",
  "plan",
  "mode",
  "commands",
])

export const chatEventPayloadSchema = z.record(z.string(), z.unknown())

export const structuredChatEventSchema = z.object({
  id: z.string().uuid(),
  eventId: z.string().min(1),
  runId: z.string().min(1).nullable(),
  toolCallId: z.string().min(1).nullable().optional(),
  type: chatEventTypeSchema,
  status: chatEventStatusSchema,
  seq: z.number().int().positive(),
  ts: z.string().datetime(),
  payload: chatEventPayloadSchema,
})

export const availableCommandSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  input: z
    .object({
      hint: z.string(),
    })
    .nullable()
    .optional(),
})

export type ChatEventType = z.infer<typeof chatEventTypeSchema>
export type ChatEventStatus = z.infer<typeof chatEventStatusSchema>
export type ChatMessageStatus = z.infer<typeof chatMessageStatusSchema>
export type ChatMessageKind = z.infer<typeof chatMessageKindSchema>
export type StructuredChatEvent = z.infer<typeof structuredChatEventSchema>
export type AvailableCommand = z.infer<typeof availableCommandSchema>
