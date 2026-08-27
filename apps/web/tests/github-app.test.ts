import assert from "node:assert/strict"
import { generateKeyPairSync } from "node:crypto"
import test from "node:test"

import {
  createPullRequestReview,
  isRelevantCheckSuite,
  resolvePullRequestSnapshot,
  resolvePullRequestState,
} from "../lib/github-app"

test("isRelevantCheckSuite drops suites that never ran any checks", () => {
  assert.equal(
    isRelevantCheckSuite({
      status: "queued",
      conclusion: null,
      latest_check_runs_count: 0,
    }),
    false
  )
})

test("resolvePullRequestSnapshot preserves GitHub aggregate review and CI state", () => {
  assert.deepEqual(
    resolvePullRequestSnapshot({
      state: "OPEN",
      isDraft: false,
      headRefOid: "head-42",
      reviewDecision: "CHANGES_REQUESTED",
      statusCheckRollup: { state: "FAILURE" },
    }),
    {
      state: "open",
      headSha: "head-42",
      ciState: "failure",
      reviewDecision: "changes_requested",
    }
  )
})

test("isRelevantCheckSuite keeps suites that reported a check run", () => {
  assert.equal(
    isRelevantCheckSuite({
      status: "completed",
      conclusion: "success",
      latest_check_runs_count: 1,
    }),
    true
  )
})

test("resolvePullRequestState prioritizes draft, queued, open, closed, and merged states", () => {
  assert.equal(
    resolvePullRequestState({
      state: "open",
      draft: true,
      merged: false,
      merged_at: null,
      mergeable_state: "draft",
    }),
    "draft"
  )
  assert.equal(
    resolvePullRequestState({
      state: "open",
      draft: false,
      merged: false,
      merged_at: null,
      mergeable_state: "queued",
    }),
    "queued"
  )
  assert.equal(resolvePullRequestState({ state: "open" }), "open")
  assert.equal(resolvePullRequestState({ state: "closed" }), "closed")
  assert.equal(
    resolvePullRequestState({
      state: "closed",
      merged: true,
      merged_at: "2026-07-28T00:00:00Z",
    }),
    "merged"
  )
})

// `createPullRequestReview` is the only call in `github-app.ts` that writes
// to GitHub, and the only one whose failure mode depends on the installation
// token's *permissions* rather than its validity — so it is the only one
// worth driving through a real fetch, App JWT and token cache included.
test("createPullRequestReview evicts the cached installation token on a 403 so a re-grant takes effect immediately", async (t) => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  process.env.GITHUB_APP_ID = "12345"
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({
    type: "pkcs8",
    format: "pem",
  }) as string

  // Each installation id gets its own cache entry, and the cache is module
  // state that outlives a single test — use a unique one.
  const installationId = `install-${Math.random().toString(36).slice(2)}`
  const mintedTokens: string[] = []
  let reviewAttempts = 0

  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)

    if (url.endsWith("/access_tokens")) {
      const token = `ghs_token_${mintedTokens.length + 1}`
      mintedTokens.push(token)
      return new Response(
        JSON.stringify({
          token,
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        }),
        { status: 200 }
      )
    }

    reviewAttempts += 1
    return new Response(
      JSON.stringify({ message: "Resource not accessible by integration" }),
      { status: 403 }
    )
  }) as typeof fetch

  const publish = () =>
    createPullRequestReview(installationId, "acme", "widget", 42, {
      commitId: "sha-1",
      event: "COMMENT",
      body: "body",
    })

  await assert.rejects(publish(), /Resource not accessible by integration/)
  await assert.rejects(publish(), /Resource not accessible by integration/)

  assert.equal(reviewAttempts, 2)
  // Without the eviction the second attempt would reuse the first token,
  // which still carries the pre-grant permissions.
  assert.deepEqual(mintedTokens, ["ghs_token_1", "ghs_token_2"])
})
