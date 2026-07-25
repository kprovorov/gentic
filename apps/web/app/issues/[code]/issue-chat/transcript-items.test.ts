import assert from "node:assert/strict"
import { test } from "node:test"

import { groupChatMessages, isVisibleChatMessage } from "./transcript-items"
import type { ChatMessage } from "./types"

const baseMessage: ChatMessage = {
  id: "message-1",
  role: "assistant",
  kind: "text",
  content: "hello",
  status: "complete",
  created_at: "2026-07-01T00:00:00.000Z",
}

test("isVisibleChatMessage hides available command events", () => {
  assert.equal(
    isVisibleChatMessage({
      ...baseMessage,
      event_type: "available_commands",
    }),
    false
  )
  assert.equal(isVisibleChatMessage(baseMessage), true)
})

test("groupChatMessages groups adjacent tool calls without crossing message rows", () => {
  const grouped = groupChatMessages([
    { ...baseMessage, id: "user-1", role: "user" },
    { ...baseMessage, id: "tool-1", kind: "tool" },
    { ...baseMessage, id: "tool-2", kind: "tool" },
    { ...baseMessage, id: "assistant-1" },
    { ...baseMessage, id: "tool-3", kind: "tool" },
  ])

  assert.deepEqual(
    grouped.map((item) =>
      item.kind === "tool-group"
        ? { kind: item.kind, ids: item.messages.map((message) => message.id) }
        : { kind: item.kind, id: item.message.id }
    ),
    [
      { kind: "message", id: "user-1" },
      { kind: "tool-group", ids: ["tool-1", "tool-2"] },
      { kind: "message", id: "assistant-1" },
      { kind: "tool-group", ids: ["tool-3"] },
    ]
  )
})
