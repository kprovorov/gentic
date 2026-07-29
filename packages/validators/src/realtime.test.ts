import assert from "node:assert/strict"
import { test } from "node:test"

import {
  chatMessageSchema,
  issueEventSchema,
  messageEventSchema,
} from "./realtime.js"

test("chatMessageSchema accepts legacy messages without authorship metadata", () => {
  const row = chatMessageSchema.parse({
    id: "legacy-message",
    role: "user",
    kind: "text",
    content: "Ship it",
    status: "complete",
    created_at: "2026-07-29T12:00:00.000Z",
  })

  assert.equal(row.author_type, undefined)
  assert.equal(row.generated_action, undefined)
})

test("chatMessageSchema accepts Gentic-authored user prompts", () => {
  const row = chatMessageSchema.parse({
    id: "automatic-message",
    role: "user",
    kind: "text",
    content: "GitHub tests failed.",
    status: "complete",
    author_type: "gentic",
    created_at: "2026-07-29T12:00:00.000Z",
  })

  assert.equal(row.role, "user")
  assert.equal(row.author_type, "gentic")
})

test("messageEventSchema defaults realtime assistant authorship to agent", () => {
  const event = messageEventSchema.parse({
    id: "8f14e45f-ceea-467e-b7ea-05a3e2b3f4c1",
    seq: 1,
    role: "assistant",
    kind: "text",
    content: "Done",
    status: "complete",
    ts: "2026-07-29T12:00:00.000Z",
  })

  assert.equal(event.author_type, "agent")
})

test("messageEventSchema accepts event timestamps with timezone offsets", () => {
  const event = messageEventSchema.parse({
    id: "8f14e45f-ceea-467e-b7ea-05a3e2b3f4c1",
    seq: 1,
    role: "assistant",
    kind: "text",
    content: "Done",
    status: "complete",
    event_ts: "2026-07-29T14:00:00+02:00",
    ts: "2026-07-29T12:00:00.000Z",
  })

  assert.equal(event.event_ts, "2026-07-29T14:00:00+02:00")
})

test("messageEventSchema requires generated actions to be Gentic-authored", () => {
  assert.throws(() =>
    messageEventSchema.parse({
      id: "8f14e45f-ceea-467e-b7ea-05a3e2b3f4c1",
      seq: 1,
      role: "system",
      kind: "text",
      content: "Create a pull request.",
      status: "complete",
      author_type: "agent",
      generated_action: "create_pr",
      ts: "2026-07-29T12:00:00.000Z",
    })
  )
})

test("issueEventSchema parses a well-formed issue_events row", () => {
  const row = {
    id: "8f14e45f-ceea-467e-b7ea-05a3e2b3f4c1",
    issue_id: "3f14e45f-ceea-467e-b7ea-05a3e2b3f4c2",
    type: "status_changed",
    payload: { from: "todo", to: "in-progress" },
    created_at: "2026-07-26T12:00:00.000Z",
  }

  assert.deepEqual(issueEventSchema.parse(row), row)
})

test("issueEventSchema defaults an empty payload object", () => {
  const row = {
    id: "8f14e45f-ceea-467e-b7ea-05a3e2b3f4c1",
    issue_id: "3f14e45f-ceea-467e-b7ea-05a3e2b3f4c2",
    type: "created",
    payload: {},
    created_at: "2026-07-26T12:00:00.000Z",
  }

  assert.deepEqual(issueEventSchema.parse(row), row)
})

test("issueEventSchema parses priority_changed payloads", () => {
  const row = {
    id: "8f14e45f-ceea-467e-b7ea-05a3e2b3f4c1",
    issue_id: "3f14e45f-ceea-467e-b7ea-05a3e2b3f4c2",
    type: "priority_changed",
    payload: { from: "medium", to: "urgent" },
    created_at: "2026-07-26T12:00:00.000Z",
  }

  assert.deepEqual(issueEventSchema.parse(row), row)
})

test("issueEventSchema rejects malformed priority_changed payloads", () => {
  assert.throws(() =>
    issueEventSchema.parse({
      id: "8f14e45f-ceea-467e-b7ea-05a3e2b3f4c1",
      issue_id: "3f14e45f-ceea-467e-b7ea-05a3e2b3f4c2",
      type: "priority_changed",
      payload: { from: "normal", to: "urgent" },
      created_at: "2026-07-26T12:00:00.000Z",
    })
  )
})

test("issueEventSchema rejects rows missing required fields", () => {
  assert.throws(() =>
    issueEventSchema.parse({
      id: "8f14e45f-ceea-467e-b7ea-05a3e2b3f4c1",
      type: "created",
      payload: {},
      created_at: "2026-07-26T12:00:00.000Z",
    })
  )
})

test("issueEventSchema rejects a non-uuid id", () => {
  assert.throws(() =>
    issueEventSchema.parse({
      id: "not-a-uuid",
      issue_id: "3f14e45f-ceea-467e-b7ea-05a3e2b3f4c2",
      type: "created",
      payload: {},
      created_at: "2026-07-26T12:00:00.000Z",
    })
  )
})
