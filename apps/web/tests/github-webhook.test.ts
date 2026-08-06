import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import test from "node:test"

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
  }
) {
  const associations: Array<Record<string, unknown>> = []
  const deliveryStates: Array<Record<string, unknown>> = []
  const hydrationCalls: Array<Record<string, unknown>> = []

  return {
    associations,
    deliveryStates,
    hydrationCalls,
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

test("isPullRequestIssue recognizes PR issue_comment payloads", () => {
  assert.equal(
    isPullRequestIssue({ issue: { number: 42, pull_request: {} } }),
    true
  )
  assert.equal(isPullRequestIssue({ issue: { number: 1 } }), false)
})
