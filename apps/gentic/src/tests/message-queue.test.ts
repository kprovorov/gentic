import assert from "node:assert/strict"
import { test } from "node:test"

import { enqueueUserMessage, type QueuedMessage } from "../worker.js"

test("user message queue orders by database sequence under skewed timestamps", () => {
  const queue: QueuedMessage[] = []
  const seen = new Set<string>()

  enqueueUserMessage(queue, seen, {
    id: "later-clock",
    content: "second",
    created_at: "2026-07-14T12:00:00.000Z",
    seq: 2,
  })
  enqueueUserMessage(queue, seen, {
    id: "earlier-clock",
    content: "first",
    created_at: "2026-07-14T12:05:00.000Z",
    seq: 1,
  })
  enqueueUserMessage(queue, seen, {
    id: "same-time",
    content: "third",
    created_at: "2026-07-14T12:00:00.000Z",
    seq: 3,
  })

  assert.deepEqual(
    queue.map((message) => message.id),
    ["earlier-clock", "later-clock", "same-time"]
  )
})

test("user message queue dedupes backlog and realtime deliveries by id", () => {
  const queue: QueuedMessage[] = []
  const seen = new Set<string>()
  const message = {
    id: "11111111-1111-4111-8111-111111111111",
    content: "hello",
    created_at: "2026-07-14T12:00:00.000Z",
    seq: 42,
  }

  assert.equal(enqueueUserMessage(queue, seen, message), true)
  assert.equal(enqueueUserMessage(queue, seen, message), false)
  assert.equal(queue.length, 1)
})
