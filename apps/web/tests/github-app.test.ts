import assert from "node:assert/strict"
import { generateKeyPairSync } from "node:crypto"
import test from "node:test"

import {
  createPullRequestReview,
  fetchPullRequestMetadata,
  fetchRepositoryMergeMethods,
  isRelevantCheckSuite,
  mergePullRequest,
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

// `createPullRequestReview` and `mergePullRequest` are the two calls in
// `github-app.ts` that write to GitHub, and the only ones whose failure mode
// depends on the installation token's *permissions* rather than its validity
// — so they are the ones worth driving through a real fetch, App JWT and
// token cache included.
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

// The same App JWT + token-cache stubbing the review test above does inline,
// factored out for the merge-path tests that follow.
function stubInstallationApi(
  t: { after: (fn: () => void) => void },
  handler: (url: string, init?: RequestInit) => Response
) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  process.env.GITHUB_APP_ID = "12345"
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey.export({
    type: "pkcs8",
    format: "pem",
  }) as string

  const mintedTokens: string[] = []
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
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

    return handler(url, init)
  }) as typeof fetch

  return {
    mintedTokens,
    // The token cache is module state that outlives a single test.
    installationId: `install-${Math.random().toString(36).slice(2)}`,
  }
}

test("fetchRepositoryMergeMethods keeps only the methods the repository allows, in preference order", async (t) => {
  const { installationId } = stubInstallationApi(
    t,
    () =>
      new Response(
        JSON.stringify({
          allow_squash_merge: false,
          allow_merge_commit: true,
          allow_rebase_merge: true,
        }),
        { status: 200 }
      )
  )

  assert.deepEqual(
    await fetchRepositoryMergeMethods(installationId, "acme", "widget"),
    ["merge", "rebase"]
  )
})

// A GitHub Enterprise old enough to omit these fields should behave like a
// repository with all three enabled, not like one that can never be merged.
test("fetchRepositoryMergeMethods treats an absent flag as allowed", async (t) => {
  const { installationId } = stubInstallationApi(
    t,
    () => new Response(JSON.stringify({}), { status: 200 })
  )

  assert.deepEqual(
    await fetchRepositoryMergeMethods(installationId, "acme", "widget"),
    ["squash", "merge", "rebase"]
  )
})

test("mergePullRequest pins the merge to the requested method and head SHA", async (t) => {
  const requests: { url: string; body: unknown }[] = []
  const { installationId } = stubInstallationApi(t, (url, init) => {
    requests.push({
      url,
      body: JSON.parse(String(init?.body ?? "{}")),
    })
    return new Response(
      JSON.stringify({
        merged: true,
        sha: "merge-commit-1",
        message: "Pull Request successfully merged",
      }),
      { status: 200 }
    )
  })

  const result = await mergePullRequest(installationId, "acme", "widget", 42, {
    mergeMethod: "squash",
    sha: "head-sha-1",
  })

  assert.deepEqual(result, {
    merged: true,
    sha: "merge-commit-1",
    message: "Pull Request successfully merged",
  })
  assert.equal(
    requests[0].url,
    "https://api.github.com/repos/acme/widget/pulls/42/merge"
  )
  assert.deepEqual(requests[0].body, {
    merge_method: "squash",
    sha: "head-sha-1",
  })
})

test("mergePullRequest evicts the cached installation token on a 403 so a re-grant takes effect immediately", async (t) => {
  let mergeAttempts = 0
  const { installationId, mintedTokens } = stubInstallationApi(t, () => {
    mergeAttempts += 1
    return new Response(
      JSON.stringify({ message: "Resource not accessible by integration" }),
      { status: 403 }
    )
  })

  const merge = () =>
    mergePullRequest(installationId, "acme", "widget", 42, {
      mergeMethod: "squash",
      sha: "head-sha-1",
    })

  await assert.rejects(merge(), /Resource not accessible by integration/)
  await assert.rejects(merge(), /Resource not accessible by integration/)

  assert.equal(mergeAttempts, 2)
  // Without the eviction the second attempt would reuse the first token,
  // which still carries the pre-grant permissions.
  assert.deepEqual(mintedTokens, ["ghs_token_1", "ghs_token_2"])
})

// GEN-455: `pull_request.base.sha` is the base branch's tip as of the PR's
// last sync, not the commit it forked from. Diffing the head against it makes
// every commit that landed on the base branch since the fork look like a
// revert authored by this PR — which is what produced a blocking review
// finding about a file the PR never touched.
test("fetchPullRequestMetadata returns the merge base, not the base branch tip", async (t) => {
  const requested: string[] = []
  const { installationId } = stubInstallationApi(t, (url) => {
    requested.push(url)

    if (url.includes("/compare/")) {
      return new Response(
        JSON.stringify({
          merge_base_commit: { sha: "fork-point-sha" },
        }),
        { status: 200 }
      )
    }

    return new Response(
      JSON.stringify({
        title: "PR title",
        body: "PR body",
        base: { ref: "main", sha: "base-branch-tip-sha" },
        head: { sha: "head-sha" },
      }),
      { status: 200 }
    )
  })

  const metadata = await fetchPullRequestMetadata(
    installationId,
    "acme",
    "widget",
    42,
    "head-sha"
  )

  assert.deepEqual(metadata, {
    title: "PR title",
    body: "PR body",
    baseRef: "main",
    mergeBaseSha: "fork-point-sha",
  })
  assert.ok(
    requested.some((url) =>
      url.includes("/repos/acme/widget/compare/main...head-sha")
    ),
    `expected a three-dot compare call, got ${JSON.stringify(requested)}`
  )
})

// A rebase or force-push can land between a review run being created (which
// freezes its head SHA) and the host fetching that run's context. The host
// clones and diffs the frozen SHA, so the merge base has to belong to that
// same commit; one computed for the newer head would make the commits between
// the two fork points look like reversions authored by the PR.
test("fetchPullRequestMetadata compares the pinned head, not GitHub's live PR head", async (t) => {
  const requested: string[] = []
  const { installationId } = stubInstallationApi(t, (url) => {
    requested.push(url)

    if (url.includes("/compare/")) {
      return new Response(
        JSON.stringify({ merge_base_commit: { sha: "fork-point-sha" } }),
        { status: 200 }
      )
    }

    return new Response(
      JSON.stringify({
        title: "PR title",
        body: null,
        base: { ref: "main", sha: "base-branch-tip-sha" },
        // GitHub already reflects a force-push this review run predates.
        head: { sha: "rebased-onto-newer-main" },
      }),
      { status: 200 }
    )
  })

  await fetchPullRequestMetadata(
    installationId,
    "acme",
    "widget",
    42,
    "pinned-at-run-creation"
  )

  const compare = requested.find((url) => url.includes("/compare/"))
  assert.ok(
    compare?.includes("main...pinned-at-run-creation"),
    `expected the pinned head in the compare, got ${compare}`
  )
  assert.ok(
    !compare?.includes("rebased-onto-newer-main"),
    "the PR's live head must not drive the merge base"
  )
})

test("fetchPullRequestMetadata degrades the merge base to null when the compare fails", async (t) => {
  const { installationId } = stubInstallationApi(t, (url) => {
    if (url.includes("/compare/")) {
      return new Response(JSON.stringify({ message: "Not Found" }), {
        status: 404,
      })
    }

    return new Response(
      JSON.stringify({
        title: "PR title",
        body: null,
        base: { ref: "main", sha: "base-branch-tip-sha" },
        head: { sha: "head-sha" },
      }),
      { status: 200 }
    )
  })

  const metadata = await fetchPullRequestMetadata(
    installationId,
    "acme",
    "widget",
    42,
    "head-sha"
  )

  // Null makes the host skip the diff entirely. Falling back to the base tip
  // here is precisely the bug, so it must never happen.
  assert.equal(metadata.mergeBaseSha, null)
  assert.equal(metadata.baseRef, "main")
})
