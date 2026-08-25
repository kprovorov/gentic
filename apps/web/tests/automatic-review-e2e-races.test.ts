import assert from "node:assert/strict"
import { createHmac } from "node:crypto"

import {
  completeReviewAttempt,
  evaluateReviewEligibility,
  supersedeActiveReviewCycle,
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
  seedWorker,
  testAccount,
} from "./helpers/live-review-harness"

// Genuine concurrency: every race below is driven with `Promise.all` over
// two independently-created service clients, so the two calls are two real,
// simultaneous HTTP requests to PostgREST racing on the same Postgres rows
// — not two sequential calls inside one transaction (which is all
// `supabase/tests/review_run_claiming_test.sql`'s existing "contest"
// scenario proves). See docs/adr/0008-automatic-review-e2e-hardening.md for
// why this is expressed as parallel service-client calls rather than
// pgTAP + dblink.

const webhookSecret = "e2e-races-test-secret"

function signedPullRequestWebhook(payload: Record<string, unknown>) {
  const body = JSON.stringify(payload)
  const signature = `sha256=${createHmac("sha256", webhookSecret)
    .update(body)
    .digest("hex")}`

  return new Request("http://localhost/api/integrations/github/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "pull_request",
      "x-hub-signature-256": signature,
    },
    body,
  })
}

function fakeGithubSnapshot(headSha: string) {
  return async () => ({
    state: "open" as const,
    headSha,
    ciState: "success" as const,
    reviewDecision: "review_required" as const,
  })
}

liveTest(
  "two workers racing to claim the same pending review run — exactly one wins",
  async () => {
    const supabaseA = createTestServiceClient()
    const supabaseB = createTestServiceClient()
    const tracker = newSeedTracker()
    const userId = testAccount("claimrace")

    try {
      const repo = `gentic-e2e/${userId}`
      const projectId = await seedProject(supabaseA, tracker, {
        userId,
        key: "TST",
        repo,
        automaticReviewEnabled: true,
      })
      const issueId = await seedIssue(supabaseA, tracker, {
        projectId,
        number: 1,
      })
      const prUrl = `https://github.com/${repo}/pull/1`
      await seedPullRequest(supabaseA, tracker, {
        issueId,
        url: prUrl,
        headSha: "sha-claimrace-1",
        ciState: "success",
      })
      const workerA = await seedWorker(supabaseA, tracker, {
        userId,
        displayName: "Worker A",
      })
      const workerB = await seedWorker(supabaseA, tracker, {
        userId,
        displayName: "Worker B",
      })

      const eligibility = await evaluateReviewEligibility(supabaseA, prUrl)
      assert.ok(eligibility?.reviewRunId)

      const [claimedByA, claimedByB] = await Promise.all([
        claimNextReviewRun(supabaseA, userId, workerA),
        claimNextReviewRun(supabaseB, userId, workerB),
      ])

      const winners = [claimedByA, claimedByB].filter(
        (result) => result !== null
      )
      assert.equal(
        winners.length,
        1,
        "exactly one concurrent claim succeeds for one pending run"
      )
      assert.equal(winners[0]?.id, eligibility!.reviewRunId)

      const { data: run } = await supabaseA
        .from("review_runs")
        .select("status, claimed_by_worker_id")
        .eq("id", eligibility!.reviewRunId!)
        .single()
      assert.equal(run?.status, "running")
      assert.ok(
        run?.claimed_by_worker_id === workerA ||
          run?.claimed_by_worker_id === workerB
      )
    } finally {
      await cleanupSeeded(supabaseA, tracker)
    }
  }
)

liveTest(
  "a genuine human changes-requested review racing the reviewer's own approval converges to one clean terminal state",
  async () => {
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const supabaseA = createTestServiceClient()
      const supabaseB = createTestServiceClient()
      const tracker = newSeedTracker()
      const userId = testAccount(`humanrace${iteration}`)

      try {
        const repo = `gentic-e2e/${userId}`
        const projectId = await seedProject(supabaseA, tracker, {
          userId,
          key: "TST",
          repo,
          automaticReviewEnabled: true,
        })
        const issueId = await seedIssue(supabaseA, tracker, {
          projectId,
          number: 1,
        })
        const prUrl = `https://github.com/${repo}/pull/1`
        await seedPullRequest(supabaseA, tracker, {
          issueId,
          url: prUrl,
          headSha: "sha-humanrace-1",
          ciState: "success",
        })

        const eligibility = await evaluateReviewEligibility(supabaseA, prUrl)
        const cycleId = eligibility!.reviewCycleId!

        // Genuinely concurrent: the reviewer's own verdict lands via
        // `completeReviewAttempt` (real RPC call over its own client) at the
        // same moment a real human posts a changes-requested review that
        // supersedes the cycle (real RPC call over a second client). Both
        // lock the same `review_cycles` row — whichever transaction commits
        // first must win cleanly, and the loser must see a safe no-op, never
        // a corrupted mixed state (e.g. an attempt recorded against an
        // already-superseded cycle, or two conflicting terminal states).
        const [completeResult, supersedeResult] = await Promise.all([
          completeReviewAttempt(supabaseA, {
            reviewRunId: eligibility!.reviewRunId!,
            verdict: "approved",
          }),
          supersedeActiveReviewCycle(supabaseB, prUrl, "human_review"),
        ])

        const { data: cycle } = await supabaseA
          .from("review_cycles")
          .select("state, superseded_reason")
          .eq("id", cycleId)
          .single()

        const { count: attemptCount } = await supabaseA
          .from("review_attempts")
          .select("id", { count: "exact", head: true })
          .eq("review_cycle_id", cycleId)

        if (completeResult.accepted) {
          // The automatic verdict won the race: the cycle is approved with
          // exactly one attempt, and the human supersession — arriving after
          // the cycle left 'active' — was a safe no-op.
          assert.equal(cycle?.state, "approved")
          assert.equal(attemptCount, 1)
          assert.equal(supersedeResult.superseded, false)
        } else {
          // The human supersession won the race: the cycle is superseded for
          // 'human_review', and the automatic verdict — arriving against a
          // cycle that had already left 'active' — recorded no attempt.
          assert.equal(cycle?.state, "superseded")
          assert.equal(cycle?.superseded_reason, "human_review")
          assert.equal(attemptCount, 0)
          assert.equal(supersedeResult.superseded, true)
        }
      } finally {
        await cleanupSeeded(supabaseA, tracker)
      }
    }
  }
)

liveTest(
  "duplicate pull_request webhooks fired truly concurrently converge to one review cycle and one review run",
  async () => {
    const supabaseA = createTestServiceClient()
    const supabaseB = createTestServiceClient()
    const tracker = newSeedTracker()
    const userId = testAccount("webhookrace")

    try {
      const repo = `gentic-e2e/${userId}`
      const projectId = await seedProject(supabaseA, tracker, {
        userId,
        key: "TST",
        repo,
        automaticReviewEnabled: true,
      })
      await seedGithubIntegration(supabaseA, tracker, {
        userId,
        installationId: "990010",
      })
      const issueId = await seedIssue(supabaseA, tracker, {
        projectId,
        number: 1,
      })

      const prUrl = `https://github.com/${repo}/pull/1`
      const payload = {
        action: "opened",
        installation: { id: 990010 },
        repository: { full_name: repo },
        pull_request: {
          html_url: prUrl,
          state: "open",
          draft: false,
          merged: false,
          merged_at: null,
          number: 1,
          head: { ref: "users/tester/TST-1-fix", sha: "sha-webhookrace-1" },
          base: { repo: { full_name: repo } },
        },
      }

      await Promise.all([
        handleGithubWebhookRequest(signedPullRequestWebhook(payload), {
          webhookSecret,
          supabase: supabaseA,
          pullRequestStateFetcher: fakeGithubSnapshot("sha-webhookrace-1"),
        }),
        handleGithubWebhookRequest(signedPullRequestWebhook(payload), {
          webhookSecret,
          supabase: supabaseB,
          pullRequestStateFetcher: fakeGithubSnapshot("sha-webhookrace-1"),
        }),
      ])

      const { data: prs } = await supabaseA
        .from("issue_pull_requests")
        .select("id")
        .eq("issue_id", issueId)
      assert.equal(
        prs?.length,
        1,
        "the unique-URL association converges to one pull request row"
      )

      const { data: cycles } = await supabaseA
        .from("review_cycles")
        .select("id")
        .eq("pull_request_id", prs![0]!.id)
      assert.equal(cycles?.length, 1, "exactly one review cycle")

      const { data: runs } = await supabaseA
        .from("review_runs")
        .select("id")
        .eq("review_cycle_id", cycles![0]!.id)
      assert.equal(runs?.length, 1, "exactly one review run")
    } finally {
      await cleanupSeeded(supabaseA, tracker)
    }
  }
)
