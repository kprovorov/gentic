import assert from "node:assert/strict"
import { createHmac, randomUUID } from "node:crypto"

import { applyPullRequestDeliveryState } from "@gentic/services/github-integrations"
import { formatReviewFixRequestMessage } from "@gentic/services/issues"
import {
  completeReviewAttempt,
  continueWithHumanReview,
  deliverReviewFixRequest,
  evaluateReviewEligibility,
  failReviewRun,
  retryReviewRun,
  shouldDeliverReviewFix,
} from "@gentic/services/review-lifecycle"

import { handleGithubWebhookRequest } from "../app/api/integrations/github/webhook/route"
import { claimNextReviewRun } from "../app/api/v1/agent/review-runs/claim/route"
import {
  cleanupSeeded,
  createTestServiceClient,
  liveTest,
  newSeedTracker,
  seedGithubIntegration,
  seedIssue,
  seedPullRequest,
  seedProject,
  seedHost,
  testAccount,
} from "./helpers/live-review-harness"

// These tests drive the real webhook route and the real Automatic Review
// Postgres state machine (`evaluate_review_eligibility` /
// `complete_review_attempt` / `fail_review_run` / ...) against a live local
// Supabase instance — no `supabase.rpc()` fakes. Only GitHub's own API is
// faked (via the webhook route's injectable `pullRequestStateFetcher`),
// exactly at the seam `github-webhook.test.ts`'s unit tier already uses.
// See docs/adr/0008-automatic-review-e2e-hardening.md.
//
// GitHub publishing itself (`publishReviewVerdict`) is intentionally not
// exercised here — it requires a real GitHub App installation token and is
// already covered by `review-publishing.test.ts`'s dependency-injected
// tests. These tests start one layer below it: `completeReviewAttempt`
// records a verdict as if publishing had already produced a
// `githubReviewId`, which is the same contract `completeReviewRun`
// (`review-runs/[id]/complete/route.ts`) calls it under.

const webhookSecret = "e2e-lifecycle-test-secret"

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

function signedPullRequestWebhook(payload: Record<string, unknown>) {
  return signedWebhook("pull_request", payload)
}

function fakeGithubSnapshot(overrides: {
  headSha: string
  ciState?: "unknown" | "pending" | "success" | "failure"
  reviewDecision?:
    "unknown" | "review_required" | "approved" | "changes_requested"
}) {
  return async () => ({
    state: "open" as const,
    headSha: overrides.headSha,
    ciState: overrides.ciState ?? "pending",
    reviewDecision: overrides.reviewDecision ?? "review_required",
  })
}

liveTest(
  "opt-in default is frozen into an immutable policy snapshot at first PR association, unaffected by later project config changes",
  async () => {
    const supabase = createTestServiceClient()
    const tracker = newSeedTracker()
    const userId = testAccount("policy")

    try {
      const repo = `gentic-e2e/${userId}`
      const projectId = await seedProject(supabase, tracker, {
        userId,
        key: "TST",
        repo,
        automaticReviewEnabled: true,
      })
      await seedGithubIntegration(supabase, tracker, {
        userId,
        installationId: "990001",
      })
      const issueId = await seedIssue(supabase, tracker, {
        projectId,
        number: 1,
      })

      const prUrl = `https://github.com/${repo}/pull/1`
      const response = await handleGithubWebhookRequest(
        signedPullRequestWebhook({
          action: "opened",
          installation: { id: 990001 },
          repository: { full_name: repo },
          pull_request: {
            html_url: prUrl,
            state: "open",
            draft: false,
            merged: false,
            merged_at: null,
            number: 1,
            head: { ref: "users/tester/TST-1-fix", sha: "sha-policy-1" },
            base: { repo: { full_name: repo } },
          },
        }),
        {
          webhookSecret,
          supabase,
          pullRequestStateFetcher: fakeGithubSnapshot({
            headSha: "sha-policy-1",
          }),
        }
      )
      assert.equal(response.status, 200)

      const { data: policyAtCreation } = await supabase
        .from("issue_review_policies")
        .select("enabled")
        .eq("issue_id", issueId)
        .single()
      assert.equal(
        policyAtCreation?.enabled,
        true,
        "the policy snapshot inherits the project's enabled setting at first PR association"
      )

      // Disabling the project setting afterward must not retroactively
      // affect an issue whose policy already froze.
      await supabase
        .from("projects")
        .update({ automatic_review_enabled: false })
        .eq("id", projectId)

      const { data: policyAfterChange } = await supabase
        .from("issue_review_policies")
        .select("enabled")
        .eq("issue_id", issueId)
        .single()
      assert.equal(
        policyAfterChange?.enabled,
        true,
        "the frozen policy snapshot is immutable once a PR exists"
      )
    } finally {
      await cleanupSeeded(supabase, tracker)
    }
  }
)

liveTest(
  "a pull request opened, tested, claimed, and approved reaches Issue status approved through the real webhook and RPC path",
  async () => {
    const supabase = createTestServiceClient()
    const tracker = newSeedTracker()
    const userId = testAccount("happy")

    try {
      const repo = `gentic-e2e/${userId}`
      const projectId = await seedProject(supabase, tracker, {
        userId,
        key: "TST",
        repo,
        automaticReviewEnabled: true,
      })
      await seedGithubIntegration(supabase, tracker, {
        userId,
        installationId: "990002",
      })
      const issueId = await seedIssue(supabase, tracker, {
        projectId,
        number: 1,
      })
      const hostId = await seedHost(supabase, tracker, {
        userId,
        displayName: "E2E Host",
      })

      const prUrl = `https://github.com/${repo}/pull/1`
      await handleGithubWebhookRequest(
        signedPullRequestWebhook({
          action: "opened",
          installation: { id: 990002 },
          repository: { full_name: repo },
          pull_request: {
            html_url: prUrl,
            state: "open",
            draft: false,
            merged: false,
            merged_at: null,
            number: 1,
            head: { ref: "users/tester/TST-1-fix", sha: "sha-happy-1" },
            base: { repo: { full_name: repo } },
          },
        }),
        {
          webhookSecret,
          supabase,
          pullRequestStateFetcher: fakeGithubSnapshot({
            headSha: "sha-happy-1",
            ciState: "pending",
          }),
        }
      )

      // CI success: the real webhook path resolves this via GitHub-fetch
      // helpers that aren't dependency-injected, so this drives the same
      // `apply_pull_request_delivery_state` / `evaluate_review_eligibility`
      // RPCs a `check_suite` "completed" delivery would, without needing to
      // fake GitHub's checks API too.
      await applyPullRequestDeliveryState(supabase, {
        prUrl,
        ciState: "success",
        expectedHeadSha: "sha-happy-1",
      })
      const eligibility = await evaluateReviewEligibility(supabase, prUrl)
      assert.equal(eligibility?.action, "queued")
      assert.ok(eligibility?.reviewRunId)

      const claimed = await claimNextReviewRun(supabase, userId, hostId)
      assert.equal(claimed?.id, eligibility?.reviewRunId)

      const completed = await completeReviewAttempt(supabase, {
        reviewRunId: eligibility!.reviewRunId!,
        verdict: "approved",
        githubReviewId: 123456,
      })
      assert.equal(completed.cycleState, "approved")

      const { data: issue } = await supabase
        .from("issues")
        .select("status")
        .eq("id", issueId)
        .single()
      assert.equal(issue?.status, "approved")
    } finally {
      await cleanupSeeded(supabase, tracker)
    }
  }
)

// GEN-428: publishing the verdict makes GitHub echo our own APPROVE review
// straight back as a `pull_request_review` delivery, which re-hydrates the
// PR snapshot and re-runs the status aggregator. GitHub reports
// `reviewDecision` as null — delivered here as `unknown` — for any
// repository that does not *require* reviews, so an aggregator that treats
// GitHub's decision as the approval source flips the Issue it just approved
// back to `ready-for-review` seconds later. This drives the real webhook
// route for that echo.
liveTest(
  "an automatic approval survives GitHub echoing the approving review back",
  async () => {
    const supabase = createTestServiceClient()
    const tracker = newSeedTracker()
    const userId = testAccount("echo")

    try {
      const repo = `gentic-e2e/${userId}`
      const projectId = await seedProject(supabase, tracker, {
        userId,
        key: "TST",
        repo,
        automaticReviewEnabled: true,
      })
      await seedGithubIntegration(supabase, tracker, {
        userId,
        installationId: "990009",
      })
      const issueId = await seedIssue(supabase, tracker, {
        projectId,
        number: 1,
      })
      const prUrl = `https://github.com/${repo}/pull/1`
      await seedPullRequest(supabase, tracker, {
        issueId,
        url: prUrl,
        headSha: "sha-echo-1",
        ciState: "success",
      })

      const eligibility = await evaluateReviewEligibility(supabase, prUrl)
      assert.equal(eligibility?.action, "queued")

      await completeReviewAttempt(supabase, {
        reviewRunId: eligibility!.reviewRunId!,
        verdict: "approved",
        githubReviewId: 778899,
      })

      const response = await handleGithubWebhookRequest(
        signedWebhook("pull_request_review", {
          action: "submitted",
          installation: { id: 990009 },
          repository: {
            name: repo.split("/")[1],
            owner: { login: repo.split("/")[0] },
          },
          review: {
            id: 778899,
            state: "approved",
            body: "Automatic review approved this pull request.",
            user: { login: "gentic-app" },
          },
          pull_request: { html_url: prUrl, number: 1 },
        }),
        {
          webhookSecret,
          supabase,
          // A repository without a review requirement: GitHub's own
          // `reviewDecision` is null however many approvals the PR carries.
          pullRequestStateFetcher: fakeGithubSnapshot({
            headSha: "sha-echo-1",
            ciState: "success",
            reviewDecision: "unknown",
          }),
        }
      )
      assert.equal(response.status, 200)

      const { data: issue } = await supabase
        .from("issues")
        .select("status")
        .eq("id", issueId)
        .single()
      assert.equal(
        issue?.status,
        "approved",
        "the echoed approval must not retract the Issue's approved status"
      )
    } finally {
      await cleanupSeeded(supabase, tracker)
    }
  }
)

liveTest(
  "three changes-requested verdicts at the same head SHA exhaust the cycle without a fourth automatic attempt",
  async () => {
    const supabase = createTestServiceClient()
    const tracker = newSeedTracker()
    const userId = testAccount("exhaust")

    try {
      const repo = `gentic-e2e/${userId}`
      const projectId = await seedProject(supabase, tracker, {
        userId,
        key: "TST",
        repo,
        automaticReviewEnabled: true,
      })
      const issueId = await seedIssue(supabase, tracker, {
        projectId,
        number: 1,
      })
      const prUrl = `https://github.com/${repo}/pull/1`
      await seedPullRequest(supabase, tracker, {
        issueId,
        url: prUrl,
        headSha: "sha-exhaust-1",
        ciState: "success",
      })

      let cycleId: string | null = null
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const sha = `sha-exhaust-${attempt}`
        if (attempt > 1) {
          await applyPullRequestDeliveryState(supabase, {
            prUrl,
            headSha: sha,
            ciState: "success",
          })
        }
        const eligibility = await evaluateReviewEligibility(supabase, prUrl)
        assert.ok(
          eligibility?.reviewRunId,
          `attempt ${attempt} queues a review run`
        )
        cycleId = eligibility!.reviewCycleId

        const result = await completeReviewAttempt(supabase, {
          reviewRunId: eligibility!.reviewRunId!,
          verdict: "changes_requested",
        })
        assert.equal(result.attemptNumber, attempt)
        assert.equal(
          result.cycleState,
          attempt < 3 ? "active" : "exhausted",
          `cycle state after attempt ${attempt}`
        )
      }

      // A further push at the exhausted cycle's SHA must not queue a fourth
      // automatic attempt against it — it starts a brand-new cycle instead.
      await applyPullRequestDeliveryState(supabase, {
        prUrl,
        headSha: "sha-exhaust-4",
        ciState: "success",
      })
      const afterExhaustion = await evaluateReviewEligibility(supabase, prUrl)
      assert.ok(
        afterExhaustion?.reviewRunId,
        "a push after exhaustion queues a run on the fresh cycle"
      )
      assert.notEqual(
        afterExhaustion?.reviewCycleId,
        cycleId,
        "a push after exhaustion opens a fresh cycle rather than reusing the exhausted one"
      )

      const { count } = await supabase
        .from("review_attempts")
        .select("id", { count: "exact", head: true })
        .eq("review_cycle_id", cycleId!)
      assert.equal(count, 3, "the exhausted cycle never exceeds 3 attempts")
    } finally {
      await cleanupSeeded(supabase, tracker)
    }
  }
)

liveTest(
  "a post-approval push opens a fresh review cycle with a full attempt budget",
  async () => {
    const supabase = createTestServiceClient()
    const tracker = newSeedTracker()
    const userId = testAccount("repush")

    try {
      const repo = `gentic-e2e/${userId}`
      const projectId = await seedProject(supabase, tracker, {
        userId,
        key: "TST",
        repo,
        automaticReviewEnabled: true,
      })
      const issueId = await seedIssue(supabase, tracker, {
        projectId,
        number: 1,
      })
      const prUrl = `https://github.com/${repo}/pull/1`
      await seedPullRequest(supabase, tracker, {
        issueId,
        url: prUrl,
        headSha: "sha-repush-1",
        ciState: "success",
      })

      const first = await evaluateReviewEligibility(supabase, prUrl)
      const approvedCycleId = first!.reviewCycleId
      await completeReviewAttempt(supabase, {
        reviewRunId: first!.reviewRunId!,
        verdict: "approved",
      })

      await applyPullRequestDeliveryState(supabase, {
        prUrl,
        headSha: "sha-repush-2",
        ciState: "success",
      })
      const second = await evaluateReviewEligibility(supabase, prUrl)

      assert.notEqual(
        second?.reviewCycleId,
        approvedCycleId,
        "a push after approval opens a new cycle"
      )
      const { count } = await supabase
        .from("review_attempts")
        .select("id", { count: "exact", head: true })
        .eq("review_cycle_id", second!.reviewCycleId!)
      assert.equal(count, 0, "the new cycle starts with a full attempt budget")
    } finally {
      await cleanupSeeded(supabase, tracker)
    }
  }
)

liveTest(
  "two consecutive infrastructure failures stop automatic retries without consuming an attempt, and retry_review_run recovers the cycle",
  async () => {
    const supabase = createTestServiceClient()
    const tracker = newSeedTracker()
    const userId = testAccount("infra")

    try {
      const repo = `gentic-e2e/${userId}`
      const projectId = await seedProject(supabase, tracker, {
        userId,
        key: "TST",
        repo,
        automaticReviewEnabled: true,
      })
      const issueId = await seedIssue(supabase, tracker, {
        projectId,
        number: 1,
      })
      const prUrl = `https://github.com/${repo}/pull/1`
      await seedPullRequest(supabase, tracker, {
        issueId,
        url: prUrl,
        headSha: "sha-infra-1",
        ciState: "success",
      })

      const eligibility = await evaluateReviewEligibility(supabase, prUrl)
      const cycleId = eligibility!.reviewCycleId!

      const firstFailure = await failReviewRun(supabase, {
        reviewRunId: eligibility!.reviewRunId!,
        error: "simulated transient infra failure",
      })
      assert.equal(firstFailure.retried, true)
      assert.ok(firstFailure.nextReviewRunId)

      const secondFailure = await failReviewRun(supabase, {
        reviewRunId: firstFailure.nextReviewRunId!,
        error: "simulated transient infra failure again",
      })
      assert.equal(
        secondFailure.retried,
        false,
        "the one-automatic-retry budget is spent"
      )

      const { count: attemptCount } = await supabase
        .from("review_attempts")
        .select("id", { count: "exact", head: true })
        .eq("review_cycle_id", cycleId)
      assert.equal(
        attemptCount,
        0,
        "infrastructure failures never consume a Review Attempt"
      )

      const { data: cycleAfterFailures } = await supabase
        .from("review_cycles")
        .select("state")
        .eq("id", cycleId)
        .single()
      assert.equal(cycleAfterFailures?.state, "active")

      const retried = await retryReviewRun(supabase, userId, cycleId)
      assert.ok(retried.reviewRunId)

      const { data: runAfterRetry } = await supabase
        .from("review_runs")
        .select("status")
        .eq("id", retried.reviewRunId)
        .single()
      assert.equal(runAfterRetry?.status, "pending")
    } finally {
      await cleanupSeeded(supabase, tracker)
    }
  }
)

liveTest(
  "continue_with_human_review forces cycle approval independent of the automatic retry path",
  async () => {
    const supabase = createTestServiceClient()
    const tracker = newSeedTracker()
    const userId = testAccount("humanok")

    try {
      const repo = `gentic-e2e/${userId}`
      const projectId = await seedProject(supabase, tracker, {
        userId,
        key: "TST",
        repo,
        automaticReviewEnabled: true,
      })
      const issueId = await seedIssue(supabase, tracker, {
        projectId,
        number: 1,
      })
      const prUrl = `https://github.com/${repo}/pull/1`
      await seedPullRequest(supabase, tracker, {
        issueId,
        url: prUrl,
        headSha: "sha-humanok-1",
        ciState: "success",
      })

      const eligibility = await evaluateReviewEligibility(supabase, prUrl)
      const result = await continueWithHumanReview(supabase, userId, issueId)
      assert.equal(result.status, "approved")

      const { data: cycle } = await supabase
        .from("review_cycles")
        .select("state")
        .eq("id", eligibility!.reviewCycleId!)
        .single()
      assert.equal(cycle?.state, "approved")
    } finally {
      await cleanupSeeded(supabase, tracker)
    }
  }
)

liveTest(
  "a changes-requested verdict delivers a fix-turn message to the original implementation session and requeues the Issue",
  async () => {
    const supabase = createTestServiceClient()
    const tracker = newSeedTracker()
    const userId = testAccount("fixdeliver")

    try {
      const repo = `gentic-e2e/${userId}`
      const projectId = await seedProject(supabase, tracker, {
        userId,
        key: "TST",
        repo,
        automaticReviewEnabled: true,
      })
      const hostId = await seedHost(supabase, tracker, {
        userId,
        displayName: "Owner Host",
      })
      const issueId = await seedIssue(supabase, tracker, {
        projectId,
        number: 1,
        status: "in-progress",
      })
      const runId = randomUUID()

      // Establish a durable implementation owner the same way a real run
      // does: claim, attach a session, then release the lease while keeping
      // the session — mirrors supabase/tests/review_fix_delivery_test.sql.
      await supabase
        .from("issues")
        .update({ active_host_id: hostId, active_run_id: runId })
        .eq("id", issueId)
      await supabase
        .from("issues")
        .update({ session_id: "e2e-session-1" })
        .eq("id", issueId)
      await supabase
        .from("issues")
        .update({
          status: "ready-for-review",
          active_run_id: null,
          active_host_id: null,
        })
        .eq("id", issueId)

      const prUrl = `https://github.com/${repo}/pull/1`
      await seedPullRequest(supabase, tracker, {
        issueId,
        url: prUrl,
        headSha: "sha-fixdeliver-1",
        ciState: "success",
      })

      const eligibility = await evaluateReviewEligibility(supabase, prUrl)
      const completed = await completeReviewAttempt(supabase, {
        reviewRunId: eligibility!.reviewRunId!,
        verdict: "changes_requested",
        findings: [
          {
            title: "Missing null check",
            evidence: "line 42 dereferences without a guard",
            impact: "crashes on empty input",
            requestedChange: "add a null check",
          },
        ],
      })
      assert.ok(shouldDeliverReviewFix(completed, "changes_requested"))

      const delivery = await deliverReviewFixRequest(supabase, {
        reviewAttemptId: completed.reviewAttemptId!,
        content: formatReviewFixRequestMessage({
          prUrl,
          attemptNumber: completed.attemptNumber ?? 1,
          summary: null,
          findings: [
            {
              title: "Missing null check",
              evidence: "line 42 dereferences without a guard",
              impact: "crashes on empty input",
              requestedChange: "add a null check",
            },
          ],
        }),
      })
      assert.equal(delivery.outcome, "delivered")

      const { data: messages } = await supabase
        .from("messages")
        .select("review_attempt_id, role")
        .eq("issue_id", issueId)
      assert.equal(messages?.length, 1)
      assert.equal(messages?.[0]?.review_attempt_id, completed.reviewAttemptId)

      const { data: issue } = await supabase
        .from("issues")
        .select("status")
        .eq("id", issueId)
        .single()
      assert.equal(issue?.status, "todo")

      // Idempotent replay: completing the exact same run again must not
      // queue a second fix-turn message.
      const replay = await deliverReviewFixRequest(supabase, {
        reviewAttemptId: completed.reviewAttemptId!,
        content: "should not be delivered again",
      })
      assert.equal(replay.outcome, "already_delivered")
      const { count } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("issue_id", issueId)
      assert.equal(count, 1)
    } finally {
      await cleanupSeeded(supabase, tracker)
    }
  }
)

liveTest(
  "a duplicate pull_request webhook delivery for the same head SHA converges to one review cycle and one review run",
  async () => {
    const supabase = createTestServiceClient()
    const tracker = newSeedTracker()
    const userId = testAccount("duplicate")

    try {
      const repo = `gentic-e2e/${userId}`
      const projectId = await seedProject(supabase, tracker, {
        userId,
        key: "TST",
        repo,
        automaticReviewEnabled: true,
      })
      await seedGithubIntegration(supabase, tracker, {
        userId,
        installationId: "990003",
      })
      const issueId = await seedIssue(supabase, tracker, {
        projectId,
        number: 1,
      })

      const prUrl = `https://github.com/${repo}/pull/1`
      const payload = {
        action: "synchronize",
        installation: { id: 990003 },
        repository: { full_name: repo },
        pull_request: {
          html_url: prUrl,
          state: "open",
          draft: false,
          merged: false,
          merged_at: null,
          number: 1,
          head: { ref: "users/tester/TST-1-fix", sha: "sha-dup-1" },
          base: { repo: { full_name: repo } },
        },
      }

      // Same delivery, replayed twice — GitHub retries webhook deliveries
      // it didn't get a fast 200 for.
      await handleGithubWebhookRequest(signedPullRequestWebhook(payload), {
        webhookSecret,
        supabase,
        pullRequestStateFetcher: fakeGithubSnapshot({
          headSha: "sha-dup-1",
          ciState: "success",
        }),
      })
      await handleGithubWebhookRequest(signedPullRequestWebhook(payload), {
        webhookSecret,
        supabase,
        pullRequestStateFetcher: fakeGithubSnapshot({
          headSha: "sha-dup-1",
          ciState: "success",
        }),
      })

      const { data: pr } = await supabase
        .from("issue_pull_requests")
        .select("id")
        .eq("issue_id", issueId)
        .single()

      const { count: cycleCount } = await supabase
        .from("review_cycles")
        .select("id", { count: "exact", head: true })
        .eq("pull_request_id", pr!.id)
      assert.equal(cycleCount, 1, "one review cycle regardless of replay")

      const { count: runCount } = await supabase
        .from("review_runs")
        .select("id", { count: "exact", head: true })
        .in(
          "review_cycle_id",
          (
            await supabase
              .from("review_cycles")
              .select("id")
              .eq("pull_request_id", pr!.id)
          ).data!.map((row) => row.id)
        )
      assert.equal(runCount, 1, "one review run regardless of replay")
    } finally {
      await cleanupSeeded(supabase, tracker)
    }
  }
)

liveTest(
  "a reordered, stale CI delivery cannot downgrade state past a newer head SHA that already advanced it",
  async () => {
    const supabase = createTestServiceClient()
    const tracker = newSeedTracker()
    const userId = testAccount("reorder")

    try {
      const repo = `gentic-e2e/${userId}`
      const projectId = await seedProject(supabase, tracker, {
        userId,
        key: "TST",
        repo,
        automaticReviewEnabled: true,
      })
      const issueId = await seedIssue(supabase, tracker, {
        projectId,
        number: 1,
      })
      const prUrl = `https://github.com/${repo}/pull/1`
      await seedPullRequest(supabase, tracker, {
        issueId,
        url: prUrl,
        headSha: "sha-reorder-1",
        ciState: "pending",
      })

      await applyPullRequestDeliveryState(supabase, {
        prUrl,
        ciState: "success",
        expectedHeadSha: "sha-reorder-1",
      })

      // The PR advances to a new commit...
      await applyPullRequestDeliveryState(supabase, {
        prUrl,
        headSha: "sha-reorder-2",
        ciState: "success",
      })

      // ...then a late, reordered "pending" delivery for the *old* SHA
      // finally arrives. It must be dropped, not applied.
      await applyPullRequestDeliveryState(supabase, {
        prUrl,
        ciState: "pending",
        expectedHeadSha: "sha-reorder-1",
      })

      const { data: pr } = await supabase
        .from("issue_pull_requests")
        .select("head_sha, ci_state")
        .eq("issue_id", issueId)
        .single()
      assert.equal(pr?.head_sha, "sha-reorder-2")
      assert.equal(
        pr?.ci_state,
        "success",
        "the stale reordered delivery did not downgrade CI state"
      )
    } finally {
      await cleanupSeeded(supabase, tracker)
    }
  }
)

// NOTE: this test documents current behavior against the acceptance
// criterion "Every open, non-draft associated pull request must pass before
// Gentic presents the work as approved." `complete_review_attempt` calls
// `set_issue_status_from_review` directly with 'approved' the moment *one*
// cycle is approved — it does not check sibling pull requests' cycle state
// the way `recompute_issue_status_from_pull_requests` (the generic
// PR-state aggregator) does. If this assertion fails, that gap is real and
// `complete_review_attempt`'s 'approved' branch needs the same
// all-reviewable-PRs-approved condition the aggregator already enforces.
liveTest(
  "an Issue with two associated pull requests should not reach approved until both review cycles are approved",
  async () => {
    const supabase = createTestServiceClient()
    const tracker = newSeedTracker()
    const userId = testAccount("multipr")

    try {
      const repo = `gentic-e2e/${userId}`
      const projectId = await seedProject(supabase, tracker, {
        userId,
        key: "TST",
        repo,
        automaticReviewEnabled: true,
      })
      const issueId = await seedIssue(supabase, tracker, {
        projectId,
        number: 1,
      })
      const prUrlA = `https://github.com/${repo}/pull/1`
      const prUrlB = `https://github.com/${repo}/pull/2`
      await seedPullRequest(supabase, tracker, {
        issueId,
        url: prUrlA,
        headSha: "sha-multipr-a1",
        ciState: "success",
      })
      await seedPullRequest(supabase, tracker, {
        issueId,
        url: prUrlB,
        headSha: "sha-multipr-b1",
        ciState: "success",
      })

      const eligibilityA = await evaluateReviewEligibility(supabase, prUrlA)
      await evaluateReviewEligibility(supabase, prUrlB)

      await completeReviewAttempt(supabase, {
        reviewRunId: eligibilityA!.reviewRunId!,
        verdict: "approved",
      })

      const { data: issueAfterFirstApproval } = await supabase
        .from("issues")
        .select("status")
        .eq("id", issueId)
        .single()
      assert.notEqual(
        issueAfterFirstApproval?.status,
        "approved",
        "the Issue must not be approved while pull request B's cycle is still active"
      )
    } finally {
      await cleanupSeeded(supabase, tracker)
    }
  }
)
