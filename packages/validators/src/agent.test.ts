import assert from "node:assert/strict"
import { test } from "node:test"

import {
  automaticPrPublishResponseSchema,
  automaticPrRequestSchema,
  claimedIssueSchema,
  completeReviewRunInputSchema,
  finishRunFieldsSchema,
  finishRunResponseSchema,
  insertMessageInputSchema,
  realtimeTokenInputSchema,
  recordUnpublishedChangesInputSchema,
  requestAutomaticPrPublishInputSchema,
  reviewerStructuredOutputSchema,
  reviewFindingInputSchema,
  reviewRunContextResponseSchema,
  reviewRunLogInputSchema,
  runStateFieldsSchema,
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
      branchName: "gen-42-fix-the-thing",
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
      branchName: "gen-42-fix-the-thing",
      createPrAutomatically: true,
      hasUnpublishedAgentChanges: false,
    }
  )
})

test("agent claim, run-state, and finish contracts reject pull request URLs", () => {
  const claimedIssue = {
    id: issueId,
    activeRunId: runId,
    code: "GEN-42",
    title: "Fix the thing",
    agentProvider: "codex",
    issueModel: null,
    repo: "gentic/app",
    setupScript: null,
    sessionId: null,
    branchName: "gen-42-fix-the-thing",
    createPrAutomatically: true,
    hasUnpublishedAgentChanges: false,
  }
  assert.throws(() =>
    claimedIssueSchema.parse({
      ...claimedIssue,
      prUrl: "https://github.com/acme/gentic/pull/42",
    })
  )

  const runState = {
    active_run_id: runId,
    status: "in-progress" as const,
  }
  assert.throws(() =>
    runStateFieldsSchema.parse({
      ...runState,
      pr_url: "https://github.com/acme/gentic/pull/42",
    })
  )
  assert.throws(() =>
    finishRunFieldsSchema.parse({
      active_run_id: runId,
      status: "waiting-for-input",
      run_finished_at: "2026-08-06T10:00:00Z",
      pr_url: "https://github.com/acme/gentic/pull/42",
    })
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
    },
  })

  assert.equal(response.created, true)
  assert.equal(response.issue.code, "GEN-42")
})

test("finishRunResponseSchema accepts a database-derived PR aggregate status", () => {
  const response = finishRunResponseSchema.parse({
    finished: true,
    status: "changes-requested",
  })

  assert.equal(response.status, "changes-requested")
})

test("reviewFindingInputSchema requires defect evidence, impact, and requested change", () => {
  const finding = reviewFindingInputSchema.parse({
    title: "Unbounded recursion",
    evidence: "foo() calls itself with no base case",
    impact: "stack overflow on any nonempty input",
    requestedChange: "add a base case",
  })
  assert.equal(finding.requestedChange, "add a base case")

  for (const missing of ["evidence", "impact", "requestedChange"] as const) {
    const input: Record<string, unknown> = {
      title: "Unbounded recursion",
      evidence: "foo() calls itself with no base case",
      impact: "stack overflow on any nonempty input",
      requestedChange: "add a base case",
    }
    delete input[missing]
    assert.throws(() => reviewFindingInputSchema.parse(input))
  }

  assert.doesNotThrow(() =>
    completeReviewRunInputSchema.parse({
      verdict: "changes_requested",
      findings: [
        {
          title: "Unbounded recursion",
          evidence: "foo() calls itself with no base case",
          impact: "stack overflow on any nonempty input",
          requestedChange: "add a base case",
        },
      ],
    })
  )
})

test("reviewerStructuredOutputSchema validates the reviewer's raw final-message payload", () => {
  const output = reviewerStructuredOutputSchema.parse({
    verdict: "changes_requested",
    summary: "One blocking issue found.",
    findings: [
      {
        defect: "Unbounded recursion",
        evidence: "foo() calls itself with no base case",
        impact: "stack overflow on any nonempty input",
        requestedChange: "add a base case",
        filePath: "src/foo.ts",
        line: 12,
      },
    ],
  })
  assert.equal(output.findings.length, 1)

  // Findings default to an empty array on an "approved" verdict.
  const approved = reviewerStructuredOutputSchema.parse({
    verdict: "approved",
  })
  assert.deepEqual(approved.findings, [])

  for (const missing of [
    "defect",
    "evidence",
    "impact",
    "requestedChange",
  ] as const) {
    const finding: Record<string, unknown> = {
      defect: "Unbounded recursion",
      evidence: "foo() calls itself with no base case",
      impact: "stack overflow on any nonempty input",
      requestedChange: "add a base case",
    }
    delete finding[missing]
    assert.throws(() =>
      reviewerStructuredOutputSchema.parse({
        verdict: "changes_requested",
        findings: [finding],
      })
    )
  }

  assert.throws(() =>
    reviewerStructuredOutputSchema.parse({ verdict: "not_a_verdict" })
  )
})

test("reviewerStructuredOutputSchema rejects an approved verdict carrying findings", () => {
  assert.throws(() =>
    reviewerStructuredOutputSchema.parse({
      verdict: "approved",
      findings: [
        {
          defect: "Unbounded recursion",
          evidence: "foo() calls itself with no base case",
          impact: "stack overflow on any nonempty input",
          requestedChange: "add a base case",
        },
      ],
    })
  )
})

test("reviewRunContextResponseSchema validates the assembled reviewer context", () => {
  const context = reviewRunContextResponseSchema.parse({
    issue: { code: "GEN-415", title: "Fix the thing", body: "Body" },
    attachments: [],
    repo: "gentic/app",
    reviewerProvider: "claude_code",
    reviewerModel: null,
    reviewerInstructions: null,
    pullRequest: {
      url: "https://github.com/gentic/app/pull/42",
      headSha: "abc123",
      ciState: "success",
      title: "Fix the thing",
      body: "PR body",
      baseRef: "main",
      baseSha: "def456",
    },
  })
  assert.equal(context.pullRequest.ciState, "success")
})

test("reviewRunLogInputSchema requires a positive seq and non-empty content", () => {
  assert.doesNotThrow(() =>
    reviewRunLogInputSchema.parse({
      seq: 1,
      role: "assistant",
      content: "Cloning...",
    })
  )
  assert.throws(() =>
    reviewRunLogInputSchema.parse({ seq: 1, role: "assistant", content: "" })
  )
  assert.throws(() =>
    reviewRunLogInputSchema.parse({
      seq: 1,
      role: "user",
      content: "not allowed",
    })
  )
  assert.throws(() =>
    reviewRunLogInputSchema.parse({
      seq: 0,
      role: "assistant",
      content: "bad seq",
    })
  )
})

test("realtimeTokenInputSchema accepts either issue chat or a review run id", () => {
  assert.doesNotThrow(() =>
    realtimeTokenInputSchema.parse({ issue_id: issueId, active_run_id: runId })
  )
  assert.doesNotThrow(() =>
    realtimeTokenInputSchema.parse({ review_run_id: runId })
  )
  assert.throws(() => realtimeTokenInputSchema.parse({}))
})
