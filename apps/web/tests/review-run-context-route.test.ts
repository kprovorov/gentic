import assert from "node:assert/strict"
import test from "node:test"

import { resolvePullRequestMetadata } from "../app/api/v1/agent/review-runs/[id]/context/route"

function fakeSupabase(integration: Record<string, unknown> | null) {
  return {
    from(table: string) {
      assert.equal(table, "github_integrations")
      return {
        select() {
          return this
        },
        eq() {
          return this
        },
        maybeSingle() {
          return Promise.resolve({ data: integration, error: null })
        },
      }
    },
  } as never
}

const empty = { title: null, body: null, baseRef: null, baseSha: null }

test("resolvePullRequestMetadata degrades to nulls when the PR URL has no number", async () => {
  const result = await resolvePullRequestMetadata(
    fakeSupabase(null),
    "user-1",
    "gentic/app",
    "https://github.com/gentic/app/pull/not-a-number"
  )
  assert.deepEqual(result, empty)
})

test("resolvePullRequestMetadata degrades to nulls when there is no GitHub integration", async () => {
  const result = await resolvePullRequestMetadata(
    fakeSupabase(null),
    "user-1",
    "gentic/app",
    "https://github.com/gentic/app/pull/42"
  )
  assert.deepEqual(result, empty)
})

test("resolvePullRequestMetadata degrades to nulls when the integration has no installation id", async () => {
  const result = await resolvePullRequestMetadata(
    fakeSupabase({ installation_id: null }),
    "user-1",
    "gentic/app",
    "https://github.com/gentic/app/pull/42"
  )
  assert.deepEqual(result, empty)
})

test("resolvePullRequestMetadata degrades to nulls when the repo has no owner/name split", async () => {
  const result = await resolvePullRequestMetadata(
    fakeSupabase({ installation_id: "123" }),
    "user-1",
    "not-a-repo-slug",
    "https://github.com/gentic/app/pull/42"
  )
  assert.deepEqual(result, empty)
})
