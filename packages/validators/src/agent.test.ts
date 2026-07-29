import assert from "node:assert/strict"
import { test } from "node:test"

import {
  automaticPrRequestSchema,
  claimedIssueSchema,
  insertMessageInputSchema,
} from "./agent.js"

const issueId = "8f14e45f-ceea-467e-b7ea-05a3e2b3f4c1"
const runId = "9f14e45f-ceea-467e-b7ea-05a3e2b3f4c1"
const messageId = "7f14e45f-ceea-467e-b7ea-05a3e2b3f4c1"

test("claimedIssueSchema includes automatic PR foundation fields", () => {
  assert.deepEqual(
    claimedIssueSchema.parse({
      id: issueId,
      activeRunId: runId,
      agentProvider: "codex",
      issueModel: null,
      repo: "gentic/app",
      setupScript: null,
      sessionId: null,
      prUrl: null,
      createPrAutomatically: true,
      hasUnpublishedAgentChanges: false,
    }),
    {
      id: issueId,
      activeRunId: runId,
      agentProvider: "codex",
      issueModel: null,
      repo: "gentic/app",
      setupScript: null,
      sessionId: null,
      prUrl: null,
      createPrAutomatically: true,
      hasUnpublishedAgentChanges: false,
    }
  )
})

test("insertMessageInputSchema validates generated create PR metadata", () => {
  const input = insertMessageInputSchema.parse({
    id: messageId,
    role: "system",
    content: "Create a pull request.",
    author_type: "gentic",
    generated_action: "create_pr",
  })

  assert.equal(input.author_type, "gentic")
  assert.equal(input.generated_action, "create_pr")
  assert.throws(() =>
    insertMessageInputSchema.parse({
      id: messageId,
      role: "assistant",
      content: "Invalid author.",
      author_type: "user",
    })
  )
  assert.throws(() =>
    insertMessageInputSchema.parse({
      id: messageId,
      role: "system",
      content: "Create a pull request.",
      author_type: "agent",
      generated_action: "create_pr",
    })
  )
})

test("automaticPrRequestSchema validates request audit rows", () => {
  const row = automaticPrRequestSchema.parse({
    id: "6f14e45f-ceea-467e-b7ea-05a3e2b3f4c1",
    issue_id: issueId,
    run_id: runId,
    requested_by_message_id: messageId,
    create_pr_automatically_snapshot: true,
    status: "pending",
    error: null,
    created_at: "2026-07-29T10:00:00Z",
    updated_at: "2026-07-29T10:00:00Z",
  })

  assert.equal(row.create_pr_automatically_snapshot, true)
  assert.throws(() =>
    automaticPrRequestSchema.parse({
      ...row,
      status: "queued",
    })
  )
})
