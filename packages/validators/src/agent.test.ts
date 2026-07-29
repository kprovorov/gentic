import assert from "node:assert/strict"
import { test } from "node:test"

import {
  automaticPrPublishResponseSchema,
  automaticPrRequestSchema,
  claimedIssueSchema,
  insertMessageInputSchema,
  recordUnpublishedChangesInputSchema,
  requestAutomaticPrPublishInputSchema,
} from "./agent.js"

const issueId = "8f14e45f-ceea-467e-b7ea-05a3e2b3f4c1"
const runId = "9f14e45f-ceea-467e-b7ea-05a3e2b3f4c1"
const messageId = "7f14e45f-ceea-467e-b7ea-05a3e2b3f4c1"

test("claimedIssueSchema includes automatic PR foundation fields", () => {
  assert.deepEqual(
    claimedIssueSchema.parse({
      id: issueId,
      activeRunId: runId,
      code: "GEN-42",
      title: "Fix the thing",
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
      code: "GEN-42",
      title: "Fix the thing",
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
    run_id: runId,
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
      run_id: runId,
      content: "Invalid author.",
      author_type: "user",
    })
  )
  assert.throws(() =>
    insertMessageInputSchema.parse({
      id: messageId,
      role: "system",
      run_id: runId,
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

test("recordUnpublishedChangesInputSchema requires an active run id and flag", () => {
  const input = recordUnpublishedChangesInputSchema.parse({
    active_run_id: runId,
    has_unpublished_agent_changes: true,
  })

  assert.equal(input.active_run_id, runId)
  assert.equal(input.has_unpublished_agent_changes, true)
  assert.throws(() =>
    recordUnpublishedChangesInputSchema.parse({
      active_run_id: runId,
    })
  )
  assert.throws(() =>
    recordUnpublishedChangesInputSchema.parse({
      active_run_id: "not-a-uuid",
      has_unpublished_agent_changes: true,
    })
  )
})

test("requestAutomaticPrPublishInputSchema requires an active run id", () => {
  const input = requestAutomaticPrPublishInputSchema.parse({
    active_run_id: runId,
  })

  assert.equal(input.active_run_id, runId)
  assert.throws(() => requestAutomaticPrPublishInputSchema.parse({}))
})

test("automaticPrPublishResponseSchema carries session-continuation context", () => {
  const response = automaticPrPublishResponseSchema.parse({
    requestId: "6f14e45f-ceea-467e-b7ea-05a3e2b3f4c1",
    messageId,
    created: true,
    status: "pending",
    issue: {
      id: issueId,
      code: "GEN-42",
      title: "Fix the thing",
      activeRunId: runId,
      createPrAutomatically: true,
      hasUnpublishedAgentChanges: true,
      prUrl: null,
    },
  })

  assert.equal(response.created, true)
  assert.equal(response.issue.code, "GEN-42")
})
