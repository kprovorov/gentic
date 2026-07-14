import assert from "node:assert/strict"
import { test } from "node:test"

import type { MessageEvent } from "@gentic/validators/realtime"

import {
  type ChatMessage,
  mergeBroadcastMessage,
  mergePersistedMessages,
} from "./issue-transcript"

const ID = "11111111-1111-4111-8111-111111111111"

test("reconnect reconciliation recovers a final answer after lost Broadcast", () => {
  const persisted = assistantMessage({
    content: "durable final answer",
    status: "complete",
    created_at: "2026-07-14T00:00:01.000Z",
  })
  const persistedIds = new Set<string>()

  const messages = mergePersistedMessages([], [persisted], persistedIds)

  assert.deepEqual(messages, [persisted])
  assert.equal(persistedIds.has(ID), true)
})

test("persisted transcript wins over delayed streaming Broadcast", () => {
  const persisted = assistantMessage({
    content: "complete from database",
    status: "complete",
    created_at: "2026-07-14T00:00:02.000Z",
  })
  const persistedIds = new Set<string>()
  const seq = new Map<string, number>()
  const reconciled = mergePersistedMessages([], [persisted], persistedIds)

  const messages = mergeBroadcastMessage(
    reconciled,
    broadcastMessage({
      seq: 1,
      content: "partial",
      status: "streaming",
      ts: "2026-07-14T00:00:01.000Z",
    }),
    seq,
    persistedIds
  )

  assert.deepEqual(messages, [persisted])
})

test("duplicate final Broadcast events deduplicate by message id and seq", () => {
  const persistedIds = new Set<string>()
  const seq = new Map<string, number>()
  const finalEvent = broadcastMessage({
    seq: 2,
    content: "final over broadcast",
    status: "complete",
    ts: "2026-07-14T00:00:03.000Z",
  })

  const once = mergeBroadcastMessage([], finalEvent, seq, persistedIds)
  const twice = mergeBroadcastMessage(once, finalEvent, seq, persistedIds)

  assert.equal(twice.length, 1)
  assert.equal(twice[0]?.id, ID)
  assert.equal(twice[0]?.content, "final over broadcast")
  assert.equal(twice[0]?.status, "complete")
})

test("persisted final replaces streaming partial without duplicating", () => {
  const persistedIds = new Set<string>()
  const seq = new Map<string, number>()
  const partial = mergeBroadcastMessage(
    [],
    broadcastMessage({
      seq: 1,
      content: "partial",
      status: "streaming",
      ts: "2026-07-14T00:00:01.000Z",
    }),
    seq,
    persistedIds
  )

  const final = assistantMessage({
    content: "persisted final",
    status: "complete",
    created_at: "2026-07-14T00:00:02.000Z",
  })
  const messages = mergePersistedMessages(partial, [final], persistedIds)

  assert.equal(messages.length, 1)
  assert.equal(messages[0]?.content, "persisted final")
  assert.equal(messages[0]?.status, "complete")
})

function assistantMessage(
  fields: Pick<ChatMessage, "content" | "status" | "created_at">
): ChatMessage {
  return {
    id: ID,
    role: "assistant",
    kind: "text",
    ...fields,
  }
}

function broadcastMessage(
  fields: Pick<MessageEvent, "seq" | "content" | "status" | "ts">
): MessageEvent {
  return {
    id: ID,
    role: "assistant",
    kind: "text",
    ...fields,
  }
}
