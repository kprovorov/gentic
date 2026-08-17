import { isVisibleChatMessage } from "../issue-chat/transcript-items"
import type { ChatMessage } from "../issue-chat-state"
import type { TimelineItem } from "./build-timeline"

export type TimelineDisplayItem =
  | { kind: "item"; item: Exclude<TimelineItem, { kind: "message" }> }
  | { kind: "message"; item: Extract<TimelineItem, { kind: "message" }> }
  | {
      kind: "tool-group"
      key: string
      timestamp: string
      messages: ChatMessage[]
    }

// Groups consecutive tool-call chat messages into a single pill, mirroring
// `groupChatMessages` in `issue-chat/transcript-items.ts`, but operating over
// the full timeline (which interleaves other node kinds between messages).
export function groupTimelineItems(
  items: TimelineItem[]
): TimelineDisplayItem[] {
  const displayItems: TimelineDisplayItem[] = []
  let toolGroup: ChatMessage[] = []

  function flushToolGroup() {
    if (toolGroup.length === 0) {
      return
    }
    displayItems.push({
      kind: "tool-group",
      key: toolGroup[0].clientKey ?? toolGroup[0].id,
      timestamp: toolGroup[0].event_ts ?? toolGroup[0].created_at,
      messages: toolGroup,
    })
    toolGroup = []
  }

  for (const item of items) {
    if (item.kind !== "message") {
      flushToolGroup()
      displayItems.push({ kind: "item", item })
      continue
    }

    if (!isVisibleChatMessage(item.message)) {
      continue
    }

    if (item.message.kind === "tool") {
      toolGroup.push(item.message)
      continue
    }

    flushToolGroup()
    displayItems.push({ kind: "message", item })
  }

  flushToolGroup()
  return displayItems
}
