import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "../errors"
import { listReviewRunLogs, listReviewStateForIssue } from "./review-state"

const OWNED_ISSUE_ROW = { id: "issue-1", projects: { user_id: "user-1" } }

function ownedIssueBuilder(issueRow: unknown = OWNED_ISSUE_ROW) {
  return {
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: issueRow, error: null }),
        }),
      }),
    }),
  }
}

const CYCLE_ROW = {
  id: "cycle-1",
  pull_request_id: "pr-1",
  state: "active",
  head_sha: "sha-1",
  superseded_reason: null,
  created_at: "2026-01-02T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  review_runs: [
    {
      id: "run-2",
      status: "running",
      error: null,
      head_sha: "sha-1",
      started_at: "2026-01-02T00:01:00Z",
      finished_at: null,
      claimed_by_worker_id: "worker-1",
      heartbeat_at: "2026-01-02T00:02:00Z",
      created_at: "2026-01-02T00:01:00Z",
    },
    {
      id: "run-1",
      status: "failed",
      error: "boom",
      head_sha: "sha-1",
      started_at: null,
      finished_at: "2026-01-02T00:00:30Z",
      claimed_by_worker_id: null,
      heartbeat_at: null,
      created_at: "2026-01-02T00:00:00Z",
    },
  ],
  review_attempts: [
    {
      id: "attempt-2",
      attempt_number: 2,
      verdict: "changes_requested",
      summary: null,
      github_review_id: null,
      published_at: null,
      created_at: "2026-01-02T00:03:00Z",
      review_findings: [
        {
          id: "finding-1",
          severity: "warning",
          file_path: "a.ts",
          line: 10,
          title: "Null deref",
          body: null,
          evidence: "line 10",
          impact: "crashes",
          requested_change: "add a check",
          github_comment_id: null,
          created_at: "2026-01-02T00:03:00Z",
        },
      ],
    },
    {
      id: "attempt-1",
      attempt_number: 1,
      verdict: "commented",
      summary: "fyi",
      github_review_id: 42,
      published_at: "2026-01-02T00:02:30Z",
      created_at: "2026-01-02T00:02:30Z",
      review_findings: [],
    },
  ],
}

test("listReviewStateForIssue enforces ownership before reading cycles", async () => {
  const client = {
    from(table: string) {
      if (table === "issues") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }

  await assert.rejects(
    listReviewStateForIssue(client as never, "user-1", "issue-1"),
    (error: unknown) => {
      assert.ok(error instanceof ServiceError)
      assert.equal(error.code, "not_found")
      return true
    }
  )
})

test("listReviewStateForIssue maps cycles/runs/attempts/findings to camelCase, sorted oldest-first within each cycle", async () => {
  const client = {
    from(table: string) {
      if (table === "issues") {
        return ownedIssueBuilder()
      }
      if (table === "review_cycles") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                returns: () => Promise.resolve({ data: [CYCLE_ROW], error: null }),
              }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }

  const [cycle] = await listReviewStateForIssue(
    client as never,
    "user-1",
    "issue-1"
  )

  assert.equal(cycle.id, "cycle-1")
  assert.equal(cycle.pullRequestId, "pr-1")
  assert.deepEqual(
    cycle.runs.map((run) => run.id),
    ["run-1", "run-2"]
  )
  assert.deepEqual(
    cycle.attempts.map((attempt) => attempt.attemptNumber),
    [1, 2]
  )
  assert.equal(cycle.attempts[1].findings[0].requestedChange, "add a check")
  assert.equal(cycle.attempts[0].githubReviewId, 42)
})

test("listReviewRunLogs rejects a run that does not belong to the issue", async () => {
  const client = {
    from(table: string) {
      if (table === "issues") {
        return ownedIssueBuilder()
      }
      if (table === "review_runs") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: "run-1", review_cycles: { issue_id: "other-issue" } },
                  error: null,
                }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }

  await assert.rejects(
    listReviewRunLogs(client as never, "user-1", "issue-1", "run-1"),
    (error: unknown) => {
      assert.ok(error instanceof ServiceError)
      assert.equal(error.code, "not_found")
      return true
    }
  )
})

test("listReviewRunLogs returns logs ordered by seq for an owned run", async () => {
  const client = {
    from(table: string) {
      if (table === "issues") {
        return ownedIssueBuilder()
      }
      if (table === "review_runs") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: "run-1", review_cycles: { issue_id: "issue-1" } },
                  error: null,
                }),
            }),
          }),
        }
      }
      if (table === "review_run_logs") {
        return {
          select: () => ({
            eq: () => ({
              order: () =>
                Promise.resolve({
                  data: [
                    {
                      id: "log-1",
                      seq: 1,
                      role: "assistant",
                      content: "Reading diff...",
                      created_at: "2026-01-02T00:00:00Z",
                    },
                  ],
                  error: null,
                }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    },
  }

  const logs = await listReviewRunLogs(
    client as never,
    "user-1",
    "issue-1",
    "run-1"
  )

  assert.deepEqual(logs, [
    {
      id: "log-1",
      seq: 1,
      role: "assistant",
      content: "Reading diff...",
      createdAt: "2026-01-02T00:00:00Z",
    },
  ])
})
