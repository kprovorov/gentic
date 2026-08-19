import assert from "node:assert/strict"
import { test } from "node:test"

import { ServiceError } from "../errors"
import {
  resolveImplementationOwner,
  startFreshImplementation,
  validateFixHandoff,
} from "./implementation-owner"

type OwnerRow = {
  id: string
  issue_id: string
  generation: number
  origin: "implementation" | "fresh_implementation"
  worker_id: string | null
  session_id: string | null
  agent_provider: "claude_code" | "codex"
  issue_model: string | null
  established_at: string
  issues: { agent_provider: string; issue_model: string | null }
  workers: { banned_at: string | null } | null
}

function ownerRow(overrides: Partial<OwnerRow> = {}): OwnerRow {
  return {
    id: "owner-1",
    issue_id: "issue-1",
    generation: 1,
    origin: "implementation",
    worker_id: "worker-1",
    session_id: "session-1",
    agent_provider: "claude_code",
    issue_model: null,
    established_at: "2026-08-19T09:00:00Z",
    issues: { agent_provider: "claude_code", issue_model: null },
    workers: { banned_at: null },
    ...overrides,
  }
}

// A minimal fake covering the two query shapes the module actually uses: the
// current-owner select chain, and the fresh-implementation RPC.
class FakeSupabase {
  readonly rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []

  constructor(
    private readonly config: {
      owner?: OwnerRow | null
      rpcResult?: { data: unknown; error: { code?: string; message: string } | null }
    } = {}
  ) {}

  from(table: string) {
    assert.equal(table, "issue_implementation_owners")
    const result = { data: this.config.owner ?? null, error: null }
    const builder = {
      select: () => builder,
      eq: () => builder,
      is: () => builder,
      maybeSingle: () => Promise.resolve(result),
    }
    return builder
  }

  rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args })
    const result = this.config.rpcResult ?? { data: null, error: null }
    return { single: () => Promise.resolve(result) }
  }
}

test("resolveImplementationOwner returns null when no owner is recorded", async () => {
  const supabase = new FakeSupabase({ owner: null })
  assert.equal(
    await resolveImplementationOwner(supabase as never, "issue-1"),
    null
  )
})

test("resolveImplementationOwner reports a healthy owner as resumable", async () => {
  const supabase = new FakeSupabase({ owner: ownerRow() })
  const owner = await resolveImplementationOwner(supabase as never, "issue-1")
  assert.equal(owner?.resumable, true)
  assert.equal(owner?.unavailableReason, null)
  assert.equal(owner?.workerId, "worker-1")
  assert.equal(owner?.sessionId, "session-1")
})

test("resolveImplementationOwner flags a changed agent provider", async () => {
  const supabase = new FakeSupabase({
    owner: ownerRow({ issues: { agent_provider: "codex", issue_model: null } }),
  })
  const owner = await resolveImplementationOwner(supabase as never, "issue-1")
  assert.equal(owner?.resumable, false)
  assert.equal(owner?.unavailableReason, "provider_changed")
})

test("resolveImplementationOwner flags a changed issue model", async () => {
  const supabase = new FakeSupabase({
    owner: ownerRow({
      issue_model: "opus",
      issues: { agent_provider: "claude_code", issue_model: "sonnet" },
    }),
  })
  const owner = await resolveImplementationOwner(supabase as never, "issue-1")
  assert.equal(owner?.unavailableReason, "provider_changed")
})

test("resolveImplementationOwner flags a missing session", async () => {
  const supabase = new FakeSupabase({
    owner: ownerRow({ session_id: null, worker_id: null }),
  })
  const owner = await resolveImplementationOwner(supabase as never, "issue-1")
  assert.equal(owner?.unavailableReason, "session_missing")
})

test("resolveImplementationOwner flags a deleted worker", async () => {
  const supabase = new FakeSupabase({
    owner: ownerRow({ worker_id: null, workers: null }),
  })
  const owner = await resolveImplementationOwner(supabase as never, "issue-1")
  assert.equal(owner?.unavailableReason, "worker_deleted")
})

test("resolveImplementationOwner flags a banned worker", async () => {
  const supabase = new FakeSupabase({
    owner: ownerRow({ workers: { banned_at: "2026-08-19T10:00:00Z" } }),
  })
  const owner = await resolveImplementationOwner(supabase as never, "issue-1")
  assert.equal(owner?.unavailableReason, "worker_banned")
})

test("resolveImplementationOwner prefers provider_changed over worker_deleted", async () => {
  const supabase = new FakeSupabase({
    owner: ownerRow({
      worker_id: null,
      workers: null,
      issues: { agent_provider: "codex", issue_model: null },
    }),
  })
  const owner = await resolveImplementationOwner(supabase as never, "issue-1")
  assert.equal(owner?.unavailableReason, "provider_changed")
})

test("validateFixHandoff accepts the current owner", async () => {
  const supabase = new FakeSupabase({ owner: ownerRow() })
  const result = await validateFixHandoff(supabase as never, "issue-1", {
    workerId: "worker-1",
    sessionId: "session-1",
  })
  assert.equal(result.ok, true)
})

test("validateFixHandoff rejects a different worker", async () => {
  const supabase = new FakeSupabase({ owner: ownerRow() })
  const result = await validateFixHandoff(supabase as never, "issue-1", {
    workerId: "worker-2",
    sessionId: "session-1",
  })
  assert.equal(result.ok, false)
  assert.equal(result.ok === false && result.reason, "not_owner")
})

test("validateFixHandoff rejects a stale session", async () => {
  const supabase = new FakeSupabase({ owner: ownerRow() })
  const result = await validateFixHandoff(supabase as never, "issue-1", {
    workerId: "worker-1",
    sessionId: "session-old",
  })
  assert.equal(result.ok === false && result.reason, "not_owner")
})

test("validateFixHandoff rejects a stale generation", async () => {
  const supabase = new FakeSupabase({ owner: ownerRow({ generation: 3 }) })
  const result = await validateFixHandoff(supabase as never, "issue-1", {
    workerId: "worker-1",
    sessionId: "session-1",
    generation: 2,
  })
  assert.equal(result.ok === false && result.reason, "not_owner")
})

test("validateFixHandoff rejects when no owner exists", async () => {
  const supabase = new FakeSupabase({ owner: null })
  const result = await validateFixHandoff(supabase as never, "issue-1", {
    workerId: "worker-1",
    sessionId: "session-1",
  })
  assert.equal(result.ok === false && result.reason, "no_owner")
  assert.equal(result.ok === false && result.owner, null)
})

test("validateFixHandoff surfaces the unavailable reason for the owner", async () => {
  const supabase = new FakeSupabase({
    owner: ownerRow({ workers: { banned_at: "2026-08-19T10:00:00Z" } }),
  })
  const result = await validateFixHandoff(supabase as never, "issue-1", {
    workerId: "worker-1",
    sessionId: "session-1",
  })
  assert.equal(result.ok === false && result.reason, "worker_banned")
})

test("startFreshImplementation returns the newly established owner", async () => {
  const freshOwner = ownerRow({
    id: "owner-2",
    generation: 2,
    origin: "fresh_implementation",
    worker_id: null,
    session_id: null,
    workers: null,
  })
  const supabase = new FakeSupabase({
    owner: freshOwner,
    rpcResult: { data: {}, error: null },
  })
  const owner = await startFreshImplementation(
    supabase as never,
    "user-1",
    "issue-1"
  )
  assert.deepEqual(supabase.rpcCalls, [
    {
      name: "start_fresh_implementation",
      args: { p_user_id: "user-1", p_issue_id: "issue-1" },
    },
  ])
  assert.equal(owner.origin, "fresh_implementation")
  assert.equal(owner.generation, 2)
  assert.equal(owner.resumable, false)
  assert.equal(owner.unavailableReason, "session_missing")
})

test("startFreshImplementation maps a missing/unauthorized issue to not_found", async () => {
  const supabase = new FakeSupabase({
    rpcResult: { data: null, error: { code: "P0002", message: "Issue not found" } },
  })
  await assert.rejects(
    startFreshImplementation(supabase as never, "user-1", "issue-1"),
    (error: unknown) =>
      error instanceof ServiceError && error.code === "not_found"
  )
})

test("startFreshImplementation maps a Spec to a validation error", async () => {
  const supabase = new FakeSupabase({
    rpcResult: {
      data: null,
      error: { code: "22023", message: "Spec issues do not run a coding agent" },
    },
  })
  await assert.rejects(
    startFreshImplementation(supabase as never, "user-1", "issue-1"),
    (error: unknown) =>
      error instanceof ServiceError && error.code === "validation"
  )
})
