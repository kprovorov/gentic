import type { ChatMessage } from "./types"

export function mergeMessage(list: ChatMessage[], incoming: ChatMessage) {
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
) {
  return incoming.reduce(mergeMessage, list)
}

export function displayedChatMessages({
  messages,
  initialMessages,
}: {
  messages: ChatMessage[]
  initialMessages: ChatMessage[]
}) {
  const isOptimisticRetryReset = initialMessages.some((message) =>
    message.id.startsWith("optimistic-retry-")
  )

  if (isOptimisticRetryReset) {
    return initialMessages
  }

  return mergeMessages(
    messages.filter((message) => !message.id.startsWith("optimistic-retry-")),
    initialMessages
  )
}
