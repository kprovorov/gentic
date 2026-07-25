import type { ChatMessage } from "./types"

export type DisplayItem =
  | { kind: "message"; message: ChatMessage }
  | { kind: "tool-group"; key: string; messages: ChatMessage[] }

export function isVisibleChatMessage(message: ChatMessage) {
  return message.event_type !== "available_commands"
}

export function groupChatMessages(messages: ChatMessage[]): DisplayItem[] {
  const items: DisplayItem[] = []
  let toolGroup: ChatMessage[] = []

  function flushToolGroup() {
    if (toolGroup.length === 0) {
      return
    }
    items.push({
      kind: "tool-group",
      key: toolGroup[0].clientKey ?? toolGroup[0].id,
      messages: toolGroup,
    })
    toolGroup = []
  }

  for (const message of messages) {
    if (!isVisibleChatMessage(message)) {
      continue
    }

    if (message.kind === "tool") {
      toolGroup.push(message)
      continue
    }

    flushToolGroup()
    items.push({ kind: "message", message })
  }

  flushToolGroup()
  return items
}
