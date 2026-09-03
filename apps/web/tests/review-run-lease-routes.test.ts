import assert from "node:assert/strict"
import test from "node:test"

import { ApiError, ensureActiveReviewRunClaim } from "../app/api/v1/agent/_lib"

const reviewRunId = "11111111-1111-4111-8111-111111111111"
const ownerId = "user-1"
const hostId = "22222222-2222-4222-8222-222222222222"

function reviewRunRow(overrides: Record<string, unknown> = {}) {
  return {
    id: reviewRunId,
    status: "running",
    claimed_by_host_id: hostId,
    review_cycles: { issues: { projects: { user_id: ownerId } } },
    ...overrides,
  }
}

class FakeQuery {
  constructor(private readonly row: Record<string, unknown> | null) {}

  select() {
    return this
  }

  eq() {
    return this
  }

  maybeSingle() {
    return Promise.resolve({ data: this.row, error: null })
  }
}

class FakeSupabase {
  constructor(private readonly row: Record<string, unknown> | null) {}

  from(table: string) {
    assert.equal(table, "review_runs")
    return new FakeQuery(this.row)
  }
}

test("accepts a review run claimed by the requesting host", async () => {
  const supabase = new FakeSupabase(reviewRunRow())

  await assert.doesNotReject(
    ensureActiveReviewRunClaim(supabase as never, ownerId, hostId, reviewRunId)
  )
})

test("404s when the review run does not belong to the requesting user", async () => {
  const supabase = new FakeSupabase(
    reviewRunRow({
      review_cycles: { issues: { projects: { user_id: "someone-else" } } },
    })
  )

  await assert.rejects(
    ensureActiveReviewRunClaim(supabase as never, ownerId, hostId, reviewRunId),
    (error: unknown) => {
      assert.ok(error instanceof ApiError)
      assert.equal(error.status, 404)
      return true
    }
  )
})

test("404s when the review run does not exist", async () => {
  const supabase = new FakeSupabase(null)

  await assert.rejects(
    ensureActiveReviewRunClaim(supabase as never, ownerId, hostId, reviewRunId),
    (error: unknown) => {
      assert.ok(error instanceof ApiError)
      assert.equal(error.status, 404)
      return true
    }
  )
})

test("409s when a different host holds the claim", async () => {
  const supabase = new FakeSupabase(
    reviewRunRow({ claimed_by_host_id: "another-host" })
  )

  await assert.rejects(
    ensureActiveReviewRunClaim(supabase as never, ownerId, hostId, reviewRunId),
    (error: unknown) => {
      assert.ok(error instanceof ApiError)
      assert.equal(error.status, 409)
      return true
    }
  )
})

test("409s once the run has left the running status (completed, failed, or cancelled)", async () => {
  for (const status of ["completed", "failed", "cancelled"]) {
    const supabase = new FakeSupabase(reviewRunRow({ status }))

    await assert.rejects(
      ensureActiveReviewRunClaim(
        supabase as never,
        ownerId,
        hostId,
        reviewRunId
      ),
      (error: unknown) => {
        assert.ok(error instanceof ApiError)
        assert.equal(error.status, 409)
        return true
      }
    )
  }
})
