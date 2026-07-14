import type { MessageEvent } from "@gentic/validators/realtime"

export type ChatMessage = {
  id: string
  // Stable React key that survives optimistic-id -> server-id swaps.
  clientKey?: string
  role: "user" | "assistant" | "system"
  kind: "text" | "tool" | "thinking"
  content: string | null
  status: "streaming" | "complete" | "error"
  created_at: string
}

export function mergeMessage(
  list: ChatMessage[],
  incoming: ChatMessage
): ChatMessage[] {
  const index = list.findIndex((message) => message.id === incoming.id)
  if (index === -1) {
    return [...list, incoming].sort((a, b) =>
      a.created_at.localeCompare(b.created_at)
    )
  }
  const next = [...list]
  const existing = next[index]
  next[index] = {
    ...incoming,
    clientKey: existing.clientKey ?? incoming.clientKey,
  }
  return next
}

export function mergeMessages(
  list: ChatMessage[],
  incoming: ChatMessage[]
): ChatMessage[] {
  return incoming.reduce(mergeMessage, list)
}

export function mergePersistedMessages(
  list: ChatMessage[],
  incoming: ChatMessage[],
  persistedMessageIds: Set<string>
): ChatMessage[] {
  for (const message of incoming) {
    persistedMessageIds.add(message.id)
  }
  return mergeMessages(list, incoming)
}

export function mergeBroadcastMessage(
  list: ChatMessage[],
  event: MessageEvent,
  messageSeq: Map<string, number>,
  persistedMessageIds: Set<string>
): ChatMessage[] {
  const lastSeq = messageSeq.get(event.id) ?? 0
  if (event.seq <= lastSeq) {
    return list
  }
  messageSeq.set(event.id, event.seq)

  if (persistedMessageIds.has(event.id)) {
    return list
  }

  const existing = list.find((message) => message.id === event.id)
  if (existing?.status !== "streaming" && event.status === "streaming") {
    return list
  }

  return mergeMessage(list, {
    id: event.id,
    role: event.role,
    kind: event.kind,
    content: event.content,
    status: event.status,
    created_at: event.ts,
  })
}
