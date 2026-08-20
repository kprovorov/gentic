import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import test from "node:test"

import { buildReviewMarker } from "../lib/review-marker"
import {
  getWorkflowRunPullNumbers,
  handleGithubWebhookRequest,
  isPullRequestIssue,
  isPendingCheckAction,
} from "../app/api/integrations/github/webhook/route"

const webhookSecret = "signed-request-test-secret"

function signedWebhook(event: string, payload: Record<string, unknown>) {
  const body = JSON.stringify(payload)
  const signature = `sha256=${createHmac("sha256", webhookSecret)
    .update(body)
    .digest("hex")}`

  return new Request("http://localhost/api/integrations/github/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      "x-hub-signature-256": signature,
    },
    body,
  })
}

function signedPullRequest(payload: Record<string, unknown>) {
  return signedWebhook("pull_request", payload)
}

function pullRequestPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: "opened",
    installation: { id: 12345 },
    repository: { full_name: "acme/base" },
    pull_request: {
      html_url: "https://github.com/acme/base/pull/42",
      state: "open",
      draft: false,
      merged: false,
      merged_at: null,
      number: 42,
      head: {
        ref: "users/alice/GEN-42-fix-webhook",
        sha: "head-42",
        repo: { full_name: "alice/base-fork" },
      },
      base: { repo: { full_name: "acme/base" } },
    },
    ...overrides,
  }
}

function pullRequestServiceRecorder(
  associationResult:
    | {
        outcome: "associated" | "already_associated"
        issueId: string
        statusChanged: boolean
      }
    | { outcome: "no_match"; reason: "invalid_issue_branch" } = {
    outcome: "associated",
    issueId: "issue-42",
    statusChanged: true,
  },
  options: { isAutomatedReview?: boolean } = {}
) {
  const associations: Array<Record<string, unknown>> = []
  const deliveryStates: Array<Record<string, unknown>> = []
  const hydrationCalls: Array<Record<string, unknown>> = []
  const eligibilityEvaluations: string[] = []
  const supersessions: Array<{ prUrl: string; reason: string }> = []
  const knownReviewAttemptChecks: number[] = []

  return {
    associations,
    deliveryStates,
    hydrationCalls,
    eligibilityEvaluations,
    supersessions,
    knownReviewAttemptChecks,
    async stateFetcher(
      installationId: string,
      owner: string,
      repo: string,
      pullNumber: number
    ) {
      hydrationCalls.push({ installationId, owner, repo, pullNumber })
      return {
        state: "open" as const,
        headSha: "hydrated-head-42",
        ciState: "failure" as const,
        reviewDecision: "changes_requested" as const,
      }
    },
    services: {
      async associatePullRequestFromWebhook(
        _supabase: unknown,
        input: Record<string, unknown>
      ) {
        associations.push(input)
        return associationResult
      },
      async applyPullRequestDeliveryState(
        _supabase: unknown,
        input: Record<string, unknown>
      ) {
        deliveryStates.push(input)
        return null
      },
      async logIssueEvent() {},
      async evaluateReviewEligibility(_supabase: unknown, prUrl: string) {
        eligibilityEvaluations.push(prUrl)
        return null
      },
      async supersedeActiveReviewCycle(
        _supabase: unknown,
        prUrl: string,
        reason: string
      ) {
        supersessions.push({ prUrl, reason })
        return { reviewCycleId: null, superseded: false }
      },
      async isKnownReviewAttempt(_supabase: unknown, githubReviewId: number) {
        knownReviewAttemptChecks.push(githubReviewId)
        return options.isAutomatedReview ?? false
      },
    },
  }
}

test("every signed pull-request action attempts association from the current fork branch and base scope", async () => {
  const recorder = pullRequestServiceRecorder()

  for (const action of ["opened", "edited", "synchronize", "closed"]) {
    const response = await handleGithubWebhookRequest(
      signedPullRequest(pullRequestPayload({ action })),
      {
        webhookSecret,
        supabase: {} as never,
        pullRequestServices: recorder.services as never,
        pullRequestStateFetcher: recorder.stateFetcher,
      }
    )
    assert.equal(response.status, 200)
  }

  assert.equal(recorder.associations.length, 4)
  for (const association of recorder.associations) {
    assert.deepEqual(association, {
      installationId: "12345",
      baseRepository: "acme/base",
      headBranch: "users/alice/GEN-42-fix-webhook",
      prUrl: "https://github.com/acme/base/pull/42",
      prState: "open",
      readyForReview: true,
      headSha: "head-42",
    })
  }
})

test("an associated pull-request delivery re-evaluates automatic review eligibility", async () => {
  const recorder = pullRequestServiceRecorder()

  const response = await handleGithubWebhookRequest(
    signedPullRequest(pullRequestPayload({ action: "synchronize" })),
    {
      webhookSecret,
      supabase: {} as never,
      pullRequestServices: recorder.services as never,
      pullRequestStateFetcher: recorder.stateFetcher,
    }
  )

  assert.equal(response.status, 200)
  assert.deepEqual(recorder.eligibilityEvaluations, [
    "https://github.com/acme/base/pull/42",
  ])
})

test("a signed unmatched pull-request branch is a successful no-op", async () => {
  const recorder = pullRequestServiceRecorder({
    outcome: "no_match",
    reason: "invalid_issue_branch",
  })

  const payload = pullRequestPayload()
  ;(payload.pull_request.head as { ref: string }).ref = "feature/not-an-issue"

  const response = await handleGithubWebhookRequest(
    signedPullRequest(payload),
    {
      webhookSecret,
      supabase: {} as never,
      pullRequestServices: recorder.services as never,
      pullRequestStateFetcher: recorder.stateFetcher,
    }
  )

  assert.equal(response.status, 200)
  assert.equal(recorder.associations.length, 1)
  assert.deepEqual(recorder.deliveryStates, [])
  assert.deepEqual(recorder.eligibilityEvaluations, [])
})

test("an existing association refreshes durable state without directly writing Issue status", async () => {
  const recorder = pullRequestServiceRecorder({
    outcome: "already_associated",
    issueId: "issue-42",
    statusChanged: false,
  })

  const response = await handleGithubWebhookRequest(
    signedPullRequest(pullRequestPayload({ action: "reopened" })),
    {
      webhookSecret,
      supabase: {} as never,
      pullRequestServices: recorder.services as never,
      pullRequestStateFetcher: recorder.stateFetcher,
    }
  )

  assert.equal(response.status, 200)
  assert.equal(recorder.associations.length, 1)
  assert.deepEqual(recorder.deliveryStates, [
    {
      prUrl: "https://github.com/acme/base/pull/42",
      state: "open",
      headSha: "hydrated-head-42",
      ciState: "failure",
      reviewDecision: "changes_requested",
    },
  ])
})

test("a first association hydrates only that pull request and persists its complete delivery state", async () => {
  const recorder = pullRequestServiceRecorder()

  const response = await handleGithubWebhookRequest(
    signedPullRequest(pullRequestPayload()),
    {
      webhookSecret,
      supabase: {} as never,
      pullRequestServices: recorder.services as never,
      pullRequestStateFetcher: recorder.stateFetcher,
    }
  )

  assert.equal(response.status, 200)
  assert.deepEqual(recorder.hydrationCalls, [
    {
      installationId: "12345",
      owner: "acme",
      repo: "base",
      pullNumber: 42,
    },
  ])
  assert.deepEqual(recorder.deliveryStates, [
    {
      prUrl: "https://github.com/acme/base/pull/42",
      state: "open",
      headSha: "hydrated-head-42",
      ciState: "failure",
      reviewDecision: "changes_requested",
    },
  ])
})

test("hydration failure keeps a newly created association and returns success", async () => {
  const recorder = pullRequestServiceRecorder()

  const response = await handleGithubWebhookRequest(
    signedPullRequest(pullRequestPayload()),
    {
      webhookSecret,
      supabase: {} as never,
      pullRequestServices: recorder.services as never,
      async pullRequestStateFetcher() {
        throw new Error("temporary GitHub failure")
      },
    }
  )

  assert.equal(response.status, 200)
  assert.equal(recorder.associations.length, 1)
  assert.deepEqual(recorder.deliveryStates, [])
})

test("getWorkflowRunPullNumbers reads pull request numbers from workflow_run payloads", () => {
  assert.deepEqual(
    getWorkflowRunPullNumbers({
      workflow_run: {
        head_sha: "abc123",
        pull_requests: [{ number: 42 }, { number: 43 }],
      },
    }),
    [42, 43]
  )
})

test("getWorkflowRunPullNumbers tolerates workflow_run payloads without pull requests", () => {
  assert.deepEqual(
    getWorkflowRunPullNumbers({
      workflow_run: {
        head_sha: "abc123",
      },
    }),
    []
  )
})

test("isPendingCheckAction recognizes GitHub rerun webhook actions", () => {
  assert.equal(isPendingCheckAction("check_suite", "requested"), true)
  assert.equal(isPendingCheckAction("check_suite", "rerequested"), true)
  assert.equal(isPendingCheckAction("check_run", "created"), true)
  assert.equal(isPendingCheckAction("check_run", "rerequested"), true)
  assert.equal(isPendingCheckAction("workflow_run", "requested"), true)
  assert.equal(isPendingCheckAction("workflow_run", "in_progress"), true)
})

test("isPendingCheckAction rejects completed and unrelated webhook actions", () => {
  assert.equal(isPendingCheckAction("check_suite", "completed"), false)
  assert.equal(isPendingCheckAction("check_run", "completed"), false)
  assert.equal(isPendingCheckAction("workflow_run", "completed"), false)
})

test("a review delivery persists GitHub's aggregate decision for the exact PR", async () => {
  const recorder = pullRequestServiceRecorder({
    outcome: "already_associated",
    issueId: "issue-42",
    statusChanged: false,
  })

  const response = await handleGithubWebhookRequest(
    signedWebhook("pull_request_review", {
      action: "submitted",
      installation: { id: 12345 },
      repository: { name: "base", owner: { login: "acme" } },
      review: {
        id: 9001,
        state: "approved",
        body: null,
        user: { login: "alice" },
      },
      pull_request: {
        html_url: "https://github.com/acme/base/pull/42",
        number: 42,
      },
    }),
    {
      webhookSecret,
      supabase: {} as never,
      pullRequestServices: recorder.services as never,
      pullRequestStateFetcher: recorder.stateFetcher,
    }
  )

  assert.equal(response.status, 200)
  assert.deepEqual(recorder.deliveryStates, [
    {
      prUrl: "https://github.com/acme/base/pull/42",
      state: "open",
      headSha: "hydrated-head-42",
      ciState: "failure",
      reviewDecision: "changes_requested",
    },
  ])
})

// `applyChangesRequestedReview` (unrelated to the supersede logic under
// test here) looks up the Issue for the PR via a plain `.from(...)` chain.
// Returning no match short-circuits it before it needs anything else.
function noFeedbackIssueSupabase() {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  }
  return { from: () => builder }
}

test("a genuine human changes-requested review supersedes an in-flight automatic cycle", async () => {
  const recorder = pullRequestServiceRecorder(
    {
      outcome: "already_associated",
      issueId: "issue-42",
      statusChanged: false,
    },
    { isAutomatedReview: false }
  )

  const response = await handleGithubWebhookRequest(
    signedWebhook("pull_request_review", {
      action: "submitted",
      installation: { id: 12345 },
      repository: { name: "base", owner: { login: "acme" } },
      review: {
        id: 9002,
        state: "changes_requested",
        body: "Please fix this",
        user: { login: "alice" },
      },
      pull_request: {
        html_url: "https://github.com/acme/base/pull/42",
        number: 42,
      },
    }),
    {
      webhookSecret,
      supabase: noFeedbackIssueSupabase() as never,
      pullRequestServices: recorder.services as never,
      pullRequestStateFetcher: recorder.stateFetcher,
    }
  )

  assert.equal(response.status, 200)
  assert.deepEqual(recorder.knownReviewAttemptChecks, [9002])
  assert.deepEqual(recorder.supersessions, [
    { prUrl: "https://github.com/acme/base/pull/42", reason: "human_review" },
  ])
})

test("our own automated review echoed back through the webhook does not supersede its cycle", async () => {
  const recorder = pullRequestServiceRecorder(
    {
      outcome: "already_associated",
      issueId: "issue-42",
      statusChanged: false,
    },
    { isAutomatedReview: true }
  )

  const response = await handleGithubWebhookRequest(
    signedWebhook("pull_request_review", {
      action: "submitted",
      installation: { id: 12345 },
      repository: { name: "base", owner: { login: "acme" } },
      review: {
        id: 9003,
        state: "changes_requested",
        body: "Automated findings",
        user: { login: "gentic-reviewer" },
      },
      pull_request: {
        html_url: "https://github.com/acme/base/pull/42",
        number: 42,
      },
    }),
    {
      webhookSecret,
      supabase: noFeedbackIssueSupabase() as never,
      pullRequestServices: recorder.services as never,
      pullRequestStateFetcher: recorder.stateFetcher,
    }
  )

  assert.equal(response.status, 200)
  assert.deepEqual(recorder.knownReviewAttemptChecks, [9003])
  assert.deepEqual(recorder.supersessions, [])
})

test("a review body carrying the Gentic marker is recognized without a database lookup", async () => {
  // `isAutomatedReview: false` proves recognition came from the marker, not
  // from the (deliberately wrong) mocked DB answer.
  const recorder = pullRequestServiceRecorder(
    {
      outcome: "already_associated",
      issueId: "issue-42",
      statusChanged: false,
    },
    { isAutomatedReview: false }
  )

  const response = await handleGithubWebhookRequest(
    signedWebhook("pull_request_review", {
      action: "submitted",
      installation: { id: 12345 },
      repository: { name: "base", owner: { login: "acme" } },
      review: {
        id: 9004,
        state: "changes_requested",
        body: `Automated findings\n\n${buildReviewMarker("review-run-1")}`,
        user: { login: "gentic-reviewer" },
      },
      pull_request: {
        html_url: "https://github.com/acme/base/pull/42",
        number: 42,
      },
    }),
    {
      webhookSecret,
      supabase: noFeedbackIssueSupabase() as never,
      pullRequestServices: recorder.services as never,
      pullRequestStateFetcher: recorder.stateFetcher,
    }
  )

  assert.equal(response.status, 200)
  assert.deepEqual(recorder.knownReviewAttemptChecks, [])
  assert.deepEqual(recorder.supersessions, [])
})

// `applyChangesRequestedReview` inserts a Gentic-authored follow-up message
// and requeues the Issue to `todo` (packages/services/src/issues/chat.ts).
// Built for plain human review feedback, before Automatic Review existed —
// without the marker/isKnownReviewAttempt gate, our own bot's echoed review
// would also flow through here, requeuing the Issue a second time and
// racing the automatic-review lifecycle's own status transition for the
// same verdict (GEN-416).
function feedbackIssueSupabase(options: { autoRespond: boolean }) {
  const messages: Record<string, unknown>[] = []
  const statusUpdates: Record<string, unknown>[] = []

  return {
    supabase: {
      from(table: string) {
        if (table === "issue_pull_requests") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { issue_id: "issue-42" },
                    error: null,
                  }),
              }),
            }),
          }
        }
        if (table === "issues") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      id: "issue-42",
                      projects: {
                        auto_respond_to_reviews: options.autoRespond,
                      },
                    },
                    error: null,
                  }),
              }),
            }),
            update: (fields: Record<string, unknown>) => ({
              eq: () => ({
                eq: () => {
                  statusUpdates.push(fields)
                  return Promise.resolve({ data: null, error: null })
                },
              }),
            }),
          }
        }
        if (table === "messages") {
          return {
            insert: (row: Record<string, unknown>) => {
              messages.push(row)
              return Promise.resolve({ error: null })
            },
          }
        }
        throw new Error(`Unexpected table in feedbackIssueSupabase: ${table}`)
      },
    },
    messages,
    statusUpdates,
  }
}

test("a genuine human changes-requested review requeues the issue via applyChangesRequestedReview", async () => {
  const recorder = pullRequestServiceRecorder(
    {
      outcome: "already_associated",
      issueId: "issue-42",
      statusChanged: false,
    },
    { isAutomatedReview: false }
  )
  const feedback = feedbackIssueSupabase({ autoRespond: true })

  const response = await handleGithubWebhookRequest(
    signedWebhook("pull_request_review", {
      action: "submitted",
      installation: { id: 12345 },
      repository: { name: "base", owner: { login: "acme" } },
      review: {
        id: 9005,
        state: "changes_requested",
        body: "Please fix this",
        user: { login: "alice" },
      },
      pull_request: {
        html_url: "https://github.com/acme/base/pull/42",
        number: 42,
      },
    }),
    {
      webhookSecret,
      supabase: feedback.supabase as never,
      pullRequestServices: recorder.services as never,
      pullRequestStateFetcher: recorder.stateFetcher,
    }
  )

  assert.equal(response.status, 200)
  assert.equal(feedback.messages.length, 1)
  assert.equal(feedback.statusUpdates.length, 1)
})

test("our own automated review echoed back does not requeue the issue via applyChangesRequestedReview", async () => {
  const recorder = pullRequestServiceRecorder(
    {
      outcome: "already_associated",
      issueId: "issue-42",
      statusChanged: false,
    },
    { isAutomatedReview: true }
  )
  const feedback = feedbackIssueSupabase({ autoRespond: true })

  const response = await handleGithubWebhookRequest(
    signedWebhook("pull_request_review", {
      action: "submitted",
      installation: { id: 12345 },
      repository: { name: "base", owner: { login: "acme" } },
      review: {
        id: 9006,
        state: "changes_requested",
        body: `Automated findings\n\n${buildReviewMarker("review-run-2")}`,
        user: { login: "gentic-reviewer" },
      },
      pull_request: {
        html_url: "https://github.com/acme/base/pull/42",
        number: 42,
      },
    }),
    {
      webhookSecret,
      supabase: feedback.supabase as never,
      pullRequestServices: recorder.services as never,
      pullRequestStateFetcher: recorder.stateFetcher,
    }
  )

  assert.equal(response.status, 200)
  assert.deepEqual(feedback.messages, [])
  assert.deepEqual(feedback.statusUpdates, [])
})

test("isPullRequestIssue recognizes PR issue_comment payloads", () => {
  assert.equal(
    isPullRequestIssue({ issue: { number: 42, pull_request: {} } }),
    true
  )
  assert.equal(isPullRequestIssue({ issue: { number: 1 } }), false)
})
