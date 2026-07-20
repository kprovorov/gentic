import assert from "node:assert/strict"
import test from "node:test"

import {
  ApiQueryError,
  fetchHomeData,
  fetchIssueDetailData,
} from "../app/client-queries"

test("client query fetches use typed API routes", async () => {
  const calls: string[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    calls.push(String(input))
    assert.equal(init?.credentials, "same-origin")
    assert.deepEqual(init?.headers, { Accept: "application/json" })

    return Response.json({ issues: [], blockedIssueIds: [] })
  }

  try {
    assert.deepEqual(await fetchHomeData(), { issues: [], blockedIssueIds: [] })
    await fetchIssueDetailData("issue id/with slash")
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.deepEqual(calls, [
    "/api/app/home",
    "/api/app/issues/issue%20id%2Fwith%20slash",
  ])
})

test("client query fetches surface API error status and code", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    Response.json(
      { error: { code: "unauthorized", message: "Unauthorized" } },
      { status: 401 }
    )

  try {
    await assert.rejects(fetchHomeData, (error) => {
      assert.ok(error instanceof ApiQueryError)
      assert.equal(error.status, 401)
      assert.equal(error.code, "unauthorized")
      assert.equal(error.message, "Unauthorized")
      return true
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
