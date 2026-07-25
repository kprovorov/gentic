import assert from "node:assert/strict"
import { test } from "node:test"

import {
  displayedChatMessages,
  mergeMessage,
  mergeMessages,
} from "./message-state"
import type { ChatMessage } from "./types"

const baseMessage: ChatMessage = {
  id: "message-1",
  role: "assistant",
  kind: "text",
  content: "hello",
  status: "streaming",
  created_at: "2026-07-01T00:00:00.000Z",
}

test("mergeMessage inserts messages in created_at order", () => {
  const later = { ...baseMessage, id: "later", created_at: "2026-07-02" }
  const earlier = { ...baseMessage, id: "earlier", created_at: "2026-07-01" }

  assert.deepEqual(
    mergeMessage([later], earlier).map((message) => message.id),
    ["earlier", "later"]
  )
})

test("mergeMessage preserves the optimistic client key when server data arrives", () => {
  const merged = mergeMessage(
    [{ ...baseMessage, clientKey: "optimistic-1" }],
    { ...baseMessage, content: "complete", status: "complete" }
  )

  assert.equal(merged[0]?.clientKey, "optimistic-1")
  assert.equal(merged[0]?.content, "complete")
})

test("mergeMessages applies a batch through the same invariant", () => {
  const merged = mergeMessages([], [
    { ...baseMessage, id: "b", created_at: "2026-07-02" },
    { ...baseMessage, id: "a", created_at: "2026-07-01" },
  ])

  assert.deepEqual(
    merged.map((message) => message.id),
    ["a", "b"]
  )
})

test("displayedChatMessages favors retry-reset optimistic transcript", () => {
  const retry = { ...baseMessage, id: "optimistic-retry-1" }
  const displayed = displayedChatMessages({
    messages: [{ ...baseMessage, id: "stale" }],
    initialMessages: [retry],
  })

  assert.deepEqual(displayed, [retry])
})
