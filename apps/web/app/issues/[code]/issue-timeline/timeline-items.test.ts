import assert from "node:assert/strict"
import { test } from "node:test"

import type { ChatMessage } from "../issue-chat-state"
import type { TimelineItem } from "./build-timeline"
import { groupTimelineItems } from "./timeline-items"

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "message-1",
    role: "assistant",
    kind: "text",
    content: "hello",
    status: "complete",
    created_at: "2026-07-01T00:05:00.000Z",
    ...overrides,
  }
}

function messageItem(overrides: Partial<ChatMessage> = {}): TimelineItem {
  const msg = message(overrides)
  return {
    kind: "message",
    key: msg.id,
    timestamp: msg.created_at,
    message: msg,
  }
}

test("passes non-message items through untouched", () => {
  const items: TimelineItem[] = [
    {
      kind: "issue-created",
      key: "issue-created",
      timestamp: "2026-07-01T00:00:00.000Z",
    },
    {
      kind: "status-milestone",
      key: "evt-1",
      timestamp: "2026-07-01T00:01:00.000Z",
      from: "todo",
      to: "in-progress",
    },
  ]

  const displayItems = groupTimelineItems(items)

  assert.deepEqual(
    displayItems.map((entry) => entry.kind),
    ["item", "item"]
  )
})

test("wraps a lone chat message in a message display item", () => {
  const item = messageItem({ id: "msg-1", kind: "text" })
  const displayItems = groupTimelineItems([item])

  assert.deepEqual(displayItems, [{ kind: "message", item }])
})

test("groups adjacent tool-call messages into a single tool-group without crossing other messages", () => {
  const toolA = messageItem({
    id: "tool-a",
    kind: "tool",
    content: "Reading file",
  })
  const toolB = messageItem({
    id: "tool-b",
    kind: "tool",
    content: "Editing file",
  })
  const reply = messageItem({ id: "reply", kind: "text", content: "Done" })

  const displayItems = groupTimelineItems([toolA, toolB, reply])

  assert.equal(displayItems.length, 2)
  assert.equal(displayItems[0].kind, "tool-group")
  assert.ok(displayItems[0].kind === "tool-group")
  assert.deepEqual(
    displayItems[0].messages.map((m) => m.id),
    ["tool-a", "tool-b"]
  )
  assert.equal(displayItems[1].kind, "message")
})

test("does not merge tool groups separated by a non-message node", () => {
  const toolA = messageItem({ id: "tool-a", kind: "tool" })
  const milestone: TimelineItem = {
    kind: "status-milestone",
    key: "evt-1",
    timestamp: "2026-07-01T00:02:00.000Z",
    from: "todo",
    to: "in-progress",
  }
  const toolB = messageItem({ id: "tool-b", kind: "tool" })

  const displayItems = groupTimelineItems([toolA, milestone, toolB])

  assert.deepEqual(
    displayItems.map((entry) => entry.kind),
    ["tool-group", "item", "tool-group"]
  )
})

test("drops available_commands messages instead of rendering them", () => {
  const hidden = messageItem({
    id: "hidden",
    kind: "commands",
    event_type: "available_commands",
  })
  const visible = messageItem({ id: "visible", kind: "text" })

  const displayItems = groupTimelineItems([hidden, visible])

  assert.deepEqual(displayItems, [{ kind: "message", item: visible }])
})
