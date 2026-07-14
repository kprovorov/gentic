import type { IssueStatus } from "@gentic/validators/issues"
import {
  messageEventSchema,
  runStateEventSchema,
} from "@gentic/validators/realtime"

import type { ChatMessage } from "./types"

export function messageFromRealtimePayload(payload: unknown): ChatMessage | null {
  const event = messageEventSchema.safeParse(payload)
  if (!event.success) {
    return null
  }

  return {
    id: event.data.id,
    role: event.data.role,
    kind: event.data.kind,
    content: event.data.content,
    status: event.data.status,
    created_at: event.data.ts,
  }
}

export function runStateFromRealtimePayload(payload: unknown): {
  status: IssueStatus
  usageLimitResetAt: string | null
  prUrl: string | null
} | null {
  const event = runStateEventSchema.safeParse(payload)
  if (!event.success) {
    return null
  }

  return {
    status: event.data.status,
    usageLimitResetAt: event.data.usage_limit_reset_at,
    prUrl: event.data.pr_url,
  }
}

export function realtimeMessageSeq(payload: unknown): {
  id: string
  seq: number
} | null {
  const event = messageEventSchema.safeParse(payload)
  if (!event.success) {
    return null
  }

  return { id: event.data.id, seq: event.data.seq }
}
