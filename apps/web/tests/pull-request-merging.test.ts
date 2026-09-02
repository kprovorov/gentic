import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "@gentic/services/errors"
import type { Supabase } from "@gentic/services/types"

import { GithubApiError } from "../lib/github-app"
import {
  classifyGithubError,
  mergeIssuePullRequest,
  type MergeIssuePullRequestDeps,
} from "../lib/pull-request-merging"

const ownershipSupabase = {} as Supabase
const serviceSupabase = {} as Supabase

const input = { userId: "user_1", pullRequestId: "pr-row-1" }

type SnapshotOverrides = Partial<{
  state: "open" | "draft" | "closed" | "merged"
  headSha: string
  ciState: "unknown" | "pending" | "success" | "failure"
  reviewDecision:
    "unknown" | "review_required" | "approved" | "changes_requested"
}>

function createDeps(
  overrides: Partial<MergeIssuePullRequestDeps> & {
    snapshot?: SnapshotOverrides
  } = {}
) {
  const { snapshot: snapshotOverrides, ...depOverrides } = overrides

  const calls = {
    merges: [] as {
      installationId: string
      owner: string
      repo: string
      pullNumber: number
      mergeMethod: string
      sha: string
    }[],
    deliveryStates: [] as { prUrl: string; state?: string }[],
  }

  const deps: MergeIssuePullRequestDeps = {
    getIssuePullRequestMergeContext: async () => ({
      pullRequestId: "pr-row-1",
      issueId: "issue-1",
      repo: "acme/widget",
      prUrl: "https://github.com/acme/widget/pull/42",
    }),
    getGithubIntegration: async () =>
      ({ installation_id: "install-1" }) as Awaited<
        ReturnType<MergeIssuePullRequestDeps["getGithubIntegration"]>
      >,
    fetchPullRequestSnapshot: async () => ({
      state: "open" as const,
      headSha: "head-sha-1",
      ciState: "success" as const,
      reviewDecision: "approved" as const,
      ...snapshotOverrides,
    }),
    fetchRepositoryMergeMethods: async () => ["squash", "merge", "rebase"],
    mergePullRequest: async (
      installationId,
      owner,
      repo,
      pullNumber,
      mergeInput
    ) => {
      calls.merges.push({
        installationId,
        owner,
        repo,
        pullNumber,
        mergeMethod: mergeInput.mergeMethod,
        sha: mergeInput.sha,
      })
      return {
        merged: true,
        sha: "merge-commit-1",
        message: "Pull Request successfully merged",
      }
    },
    applyPullRequestDeliveryState: async (_supabase, deliveryInput) => {
      calls.deliveryStates.push({
        prUrl: deliveryInput.prUrl,
        state: deliveryInput.state,
      })
      return {
        associated_issue_id: "issue-1",
        issue_status: "merged",
        issue_status_changed: true,
        pull_request_updated: true,
      }
    },
    ...depOverrides,
  }

  return { deps, calls }
}

function merge(deps: MergeIssuePullRequestDeps) {
  return mergeIssuePullRequest(ownershipSupabase, serviceSupabase, input, deps)
}

test("mergeIssuePullRequest merges an approved pull request pinned to the head it verified", async () => {
  const { deps, calls } = createDeps()

  const result = await merge(deps)

  assert.deepEqual(calls.merges, [
    {
      installationId: "install-1",
      owner: "acme",
      repo: "widget",
      pullNumber: 42,
      // Squash is the first preference the repository still allows.
      mergeMethod: "squash",
      // Merging any other commit would land code whose approval was never
      // checked.
      sha: "head-sha-1",
    },
  ])
  assert.deepEqual(result, {
    issueId: "issue-1",
    prUrl: "https://github.com/acme/widget/pull/42",
    mergeMethod: "squash",
    mergeCommitSha: "merge-commit-1",
  })
})

test("mergeIssuePullRequest falls back to the first merge method the repository still allows", async () => {
  const { deps, calls } = createDeps({
    fetchRepositoryMergeMethods: async () => ["rebase"],
  })

  await merge(deps)

  assert.equal(calls.merges[0].mergeMethod, "rebase")
})

test("mergeIssuePullRequest refuses when the repository disables every merge method", async () => {
  const { deps, calls } = createDeps({
    fetchRepositoryMergeMethods: async () => [],
  })

  await assert.rejects(merge(deps), (error: ServiceError) => {
    assert.equal(error.code, "conflict")
    assert.match(error.message, /every merge method disabled/)
    return true
  })
  assert.equal(calls.merges.length, 0)
})

// The rail decides the button from cached `issue_pull_requests` columns a
// webhook can leave behind GitHub. These are the cases where acting on that
// cache would merge something nobody approved.
test("mergeIssuePullRequest re-checks live GitHub state rather than trusting the row the button was drawn from", async () => {
  const cases: {
    snapshot: SnapshotOverrides
    message: RegExp
  }[] = [
    { snapshot: { state: "merged" }, message: /already merged/ },
    { snapshot: { state: "closed" }, message: /closed/ },
    { snapshot: { state: "draft" }, message: /still a draft/ },
    {
      snapshot: { reviewDecision: "changes_requested" },
      message: /not approved/,
    },
    { snapshot: { reviewDecision: "unknown" }, message: /not approved/ },
  ]

  for (const { snapshot, message } of cases) {
    const { deps, calls } = createDeps({ snapshot })

    await assert.rejects(merge(deps), (error: ServiceError) => {
      assert.equal(error.code, "conflict")
      assert.match(error.message, message)
      return true
    })
    assert.equal(calls.merges.length, 0, JSON.stringify(snapshot))
  }
})

test("mergeIssuePullRequest reports a refusal GitHub returns with a 200", async () => {
  const { deps, calls } = createDeps({
    mergePullRequest: async () => ({
      merged: false,
      sha: null,
      message: "Base branch was modified. Review and try the merge again.",
    }),
  })

  await assert.rejects(merge(deps), (error: ServiceError) => {
    assert.equal(error.code, "conflict")
    assert.match(error.message, /Base branch was modified/)
    return true
  })
  assert.deepEqual(calls.deliveryStates, [])
})

test("mergeIssuePullRequest requires a connected GitHub integration", async () => {
  const { deps } = createDeps({
    getGithubIntegration: async () => null,
  })

  await assert.rejects(merge(deps), (error: ServiceError) => {
    assert.equal(error.code, "forbidden")
    return true
  })
})

test("mergeIssuePullRequest rejects a pull request URL it cannot address", async () => {
  const { deps } = createDeps({
    getIssuePullRequestMergeContext: async () => ({
      pullRequestId: "pr-row-1",
      issueId: "issue-1",
      repo: "acme/widget",
      prUrl: "https://example.com/not-a-pull-request",
    }),
  })

  await assert.rejects(merge(deps), (error: ServiceError) => {
    assert.equal(error.code, "validation")
    return true
  })
})

test("mergeIssuePullRequest persists the merged state eagerly instead of waiting for the webhook", async () => {
  const { deps, calls } = createDeps()

  await merge(deps)

  assert.deepEqual(calls.deliveryStates, [
    { prUrl: "https://github.com/acme/widget/pull/42", state: "merged" },
  ])
})

// The PR is already merged by then; failing the action would tell the
// operator the opposite of what happened.
test("mergeIssuePullRequest still succeeds when the eager state write fails", async () => {
  const { deps } = createDeps({
    applyPullRequestDeliveryState: async () => {
      throw new Error("rpc unavailable")
    },
  })

  const result = await merge(deps)

  assert.equal(result.mergeCommitSha, "merge-commit-1")
})

test("mergeIssuePullRequest surfaces a GitHub failure as a classified ServiceError", async () => {
  const { deps } = createDeps({
    mergePullRequest: async () => {
      throw new GithubApiError(405, "Failed to merge pull request (405)")
    },
  })

  await assert.rejects(merge(deps), (error: ServiceError) => {
    assert.equal(error.code, "conflict")
    return true
  })
})

test("classifyGithubError maps GitHub statuses to retryability-carrying codes", () => {
  const expected: [number, string][] = [
    [401, "forbidden"],
    [403, "forbidden"],
    [404, "not_found"],
    [405, "conflict"],
    [409, "conflict"],
    [422, "validation"],
    [429, "rate_limited"],
    [500, "internal"],
  ]

  for (const [status, code] of expected) {
    assert.equal(
      classifyGithubError(new GithubApiError(status, "boom")).code,
      code,
      String(status)
    )
  }
})

// Merging needs Contents write, which installations predating GEN-434 do not
// have; GitHub reports that with the same opaque 403 it uses for a repo the
// App cannot see.
test("classifyGithubError names the missing Contents permission on a 403", () => {
  const error = classifyGithubError(
    new GithubApiError(
      403,
      "Failed to merge pull request (403): Resource not accessible by integration"
    )
  )

  assert.equal(error.code, "forbidden")
  assert.match(error.message, /Contents permission to Read & write/)
})
