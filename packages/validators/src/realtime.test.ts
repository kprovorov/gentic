import assert from "node:assert/strict"
import { test } from "node:test"

import { issueEventSchema } from "./realtime.js"

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
