import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "@gentic/services/errors"
import type { ReviewFindingInput } from "@gentic/services/review-lifecycle"

import { GithubApiError, type GithubPullRequestReview } from "../lib/github-app"
import { buildReviewMarker } from "../lib/review-marker"
import {
  publishReviewVerdict,
  type PublishReviewVerdictDeps,
} from "../lib/review-publishing"

const supabase = {} as never

function finding(
  overrides: Partial<ReviewFindingInput> = {}
): ReviewFindingInput {
  return {
    title: "Off-by-one",
    evidence: "Loop runs one iteration too many",
    impact: "Crashes on the last element",
    requestedChange: "Use < instead of <=",
    filePath: "src/app.ts",
    line: 12,
    ...overrides,
  }
}

function baseInput(
  overrides: Partial<Parameters<typeof publishReviewVerdict>[1]> = {}
) {
  return {
    reviewRunId: "run-1",
    userId: "user-1",
    repo: "acme/widget",
    prUrl: "https://github.com/acme/widget/pull/42",
    expectedHeadSha: "sha-current",
    verdict: "changes_requested" as const,
    summary: "Please fix these",
    findings: [finding()],
    ...overrides,
  }
}

function recordingDeps(
  overrides: Partial<PublishReviewVerdictDeps> = {}
): PublishReviewVerdictDeps & {
  createReviewCalls: unknown[]
} {
  const createReviewCalls: unknown[] = []

  return {
    createReviewCalls,
    async getGithubIntegration() {
      return { installation_id: "install-1" } as never
    },
    async fetchPullRequestSnapshot() {
      return {
        state: "open",
        headSha: "sha-current",
        ciState: "success",
        reviewDecision: "review_required",
      } as never
    },
    async fetchPullRequestReviews() {
      return []
    },
    async createPullRequestReview(
      _installationId,
      _owner,
      _repo,
      _pullNumber,
      input
    ) {
      createReviewCalls.push(input)
      return {
        id: 555,
        body: input.body,
        state: "CHANGES_REQUESTED",
        htmlUrl: "https://github.com/acme/widget/pull/42#pullrequestreview-555",
        submittedAt: "2026-08-20T00:00:00Z",
      }
    },
    async fetchPullRequestReviewComments() {
      return []
    },
    ...overrides,
  }
}

test("throws validation when the pull request URL has no number", async () => {
  await assert.rejects(
    publishReviewVerdict(
      supabase,
      baseInput({ prUrl: "https://github.com/acme/widget/pull/not-a-number" }),
      recordingDeps()
    ),
    (error: unknown) => {
      assert.ok(error instanceof ServiceError)
      assert.equal(error.code, "validation")
      return true
    }
  )
})

test("throws forbidden when there is no GitHub integration", async () => {
  const deps = recordingDeps({
    async getGithubIntegration() {
      return null
    },
  })

  await assert.rejects(
    publishReviewVerdict(supabase, baseInput(), deps),
    (error: unknown) => {
      assert.ok(error instanceof ServiceError)
      assert.equal(error.code, "forbidden")
      return true
    }
  )
})

test("throws conflict when the pull request is closed", async () => {
  const deps = recordingDeps({
    async fetchPullRequestSnapshot() {
      return {
        state: "closed",
        headSha: "sha-current",
        ciState: "success",
        reviewDecision: "review_required",
      } as never
    },
  })

  await assert.rejects(
    publishReviewVerdict(supabase, baseInput(), deps),
    (error: unknown) => {
      assert.ok(error instanceof ServiceError)
      assert.equal(error.code, "conflict")
      return true
    }
  )
})

test("throws conflict when the pull request is a draft", async () => {
  const deps = recordingDeps({
    async fetchPullRequestSnapshot() {
      return {
        state: "draft",
        headSha: "sha-current",
        ciState: "success",
        reviewDecision: "review_required",
      } as never
    },
  })

  await assert.rejects(
    publishReviewVerdict(supabase, baseInput(), deps),
    (error: unknown) => {
      assert.ok(error instanceof ServiceError)
      assert.equal(error.code, "conflict")
      return true
    }
  )
})

test("throws conflict when the live head SHA has moved past the verdict's SHA", async () => {
  const deps = recordingDeps({
    async fetchPullRequestSnapshot() {
      return {
        state: "open",
        headSha: "sha-newer",
        ciState: "success",
        reviewDecision: "review_required",
      } as never
    },
  })

  await assert.rejects(
    publishReviewVerdict(supabase, baseInput(), deps),
    (error: unknown) => {
      assert.ok(error instanceof ServiceError)
      assert.equal(error.code, "conflict")
      return true
    }
  )
  assert.equal(deps.createReviewCalls.length, 0)
})

test("reuses an existing review carrying this run's marker instead of creating a new one", async () => {
  const existing: GithubPullRequestReview = {
    id: 999,
    body: `Already published\n\n${buildReviewMarker("run-1")}`,
    state: "CHANGES_REQUESTED",
    htmlUrl: "https://github.com/acme/widget/pull/42#pullrequestreview-999",
    submittedAt: "2026-08-20T00:00:00Z",
  }
  const deps = recordingDeps({
    async fetchPullRequestReviews() {
      return [existing]
    },
  })

  const result = await publishReviewVerdict(supabase, baseInput(), deps)

  assert.equal(result.githubReviewId, 999)
  assert.equal(deps.createReviewCalls.length, 0)
})

test("does not match a review whose marker belongs to a different run", async () => {
  const otherRun: GithubPullRequestReview = {
    id: 998,
    body: `Already published\n\n${buildReviewMarker("some-other-run")}`,
    state: "CHANGES_REQUESTED",
    htmlUrl: "https://github.com/acme/widget/pull/42#pullrequestreview-998",
    submittedAt: "2026-08-20T00:00:00Z",
  }
  const deps = recordingDeps({
    async fetchPullRequestReviews() {
      return [otherRun]
    },
  })

  const result = await publishReviewVerdict(supabase, baseInput(), deps)

  assert.equal(result.githubReviewId, 555)
  assert.equal(deps.createReviewCalls.length, 1)
})

test("publishes findings with a file/line as inline comments and maps verdict to REQUEST_CHANGES", async () => {
  const deps = recordingDeps()

  const result = await publishReviewVerdict(supabase, baseInput(), deps)

  assert.equal(result.githubReviewId, 555)
  assert.equal(deps.createReviewCalls.length, 1)
  const call = deps.createReviewCalls[0] as {
    event: string
    commitId: string
    comments: { path: string; line: number; body: string }[]
    body: string
  }
  assert.equal(call.event, "REQUEST_CHANGES")
  assert.equal(call.commitId, "sha-current")
  assert.deepEqual(call.comments, [
    { path: "src/app.ts", line: 12, body: call.comments[0].body },
  ])
  assert.match(call.body, /gentic:review-run:run-1/)
})

test("maps approved and commented verdicts to APPROVE and COMMENT", async () => {
  const approveDeps = recordingDeps()
  await publishReviewVerdict(
    supabase,
    baseInput({ verdict: "approved", findings: [] }),
    approveDeps
  )
  assert.equal(
    (approveDeps.createReviewCalls[0] as { event: string }).event,
    "APPROVE"
  )

  const commentDeps = recordingDeps()
  await publishReviewVerdict(
    supabase,
    baseInput({ verdict: "commented", findings: [] }),
    commentDeps
  )
  assert.equal(
    (commentDeps.createReviewCalls[0] as { event: string }).event,
    "COMMENT"
  )
})

test("findings without a file/line go into the review body, not as inline comments", async () => {
  const deps = recordingDeps()

  await publishReviewVerdict(
    supabase,
    baseInput({
      findings: [
        finding({ filePath: null, line: null, title: "Missing test coverage" }),
      ],
    }),
    deps
  )

  const call = deps.createReviewCalls[0] as {
    comments: unknown[]
    body: string
  }
  assert.deepEqual(call.comments, [])
  assert.match(call.body, /Missing test coverage/)
})

test("reconciles githubCommentId onto findings by matching path and line", async () => {
  const deps = recordingDeps({
    async fetchPullRequestReviewComments() {
      return [
        {
          id: 4242,
          path: "src/app.ts",
          line: 12,
          diff_hunk: "@@ -1 +1 @@",
          body: "Off-by-one",
        },
      ]
    },
  })

  const result = await publishReviewVerdict(supabase, baseInput(), deps)

  assert.equal(result.findings[0].githubCommentId, 4242)
})

test("a 422 on inline comments retries once as a review-level-only body instead of dropping the findings", async () => {
  const calls: unknown[] = []
  const deps = recordingDeps({
    async createPullRequestReview(
      _installationId,
      _owner,
      _repo,
      _pullNumber,
      input
    ) {
      calls.push(input)
      if (calls.length === 1) {
        throw new GithubApiError(422, "Unprocessable: comment line not in diff")
      }
      return {
        id: 777,
        body: input.body,
        state: "CHANGES_REQUESTED",
        htmlUrl: "https://github.com/acme/widget/pull/42#pullrequestreview-777",
        submittedAt: "2026-08-20T00:00:00Z",
      }
    },
  })

  const result = await publishReviewVerdict(supabase, baseInput(), deps)

  assert.equal(result.githubReviewId, 777)
  assert.equal(calls.length, 2)
  const fallbackCall = calls[1] as {
    comments?: unknown[]
    body: string
  }
  assert.ok(!fallbackCall.comments || fallbackCall.comments.length === 0)
  assert.match(fallbackCall.body, /Off-by-one/)
})

test("classifies GitHub error statuses into ServiceError codes with explicit retryability", async () => {
  const cases: [number, string][] = [
    [401, "forbidden"],
    [403, "forbidden"],
    [404, "not_found"],
    [422, "validation"],
    [429, "rate_limited"],
    [500, "internal"],
  ]

  for (const [status, code] of cases) {
    const deps = recordingDeps({
      async createPullRequestReview() {
        throw new GithubApiError(status, `GitHub said ${status}`)
      },
    })

    await assert.rejects(
      publishReviewVerdict(
        supabase,
        baseInput({ findings: [finding({ filePath: null, line: null })] }),
        deps
      ),
      (error: unknown) => {
        assert.ok(error instanceof ServiceError)
        assert.equal(error.code, code)
        return true
      }
    )
  }
})
