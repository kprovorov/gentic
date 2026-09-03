import assert from "node:assert/strict"
import test from "node:test"

import { defaultHostCompatibilityPolicy } from "@gentic/services/hosts"

import { claimNextReviewRun } from "../app/api/v1/agent/review-runs/claim/route"

type Row = Record<string, unknown>
type TableName = "hosts" | "issues" | "review_runs"

class FakeDb {
  hosts: Row[] = []
  issues: Row[] = []
  review_runs: Row[] = []
}

class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<(row: Row) => boolean> = []
  private wantsSingle = false

  constructor(
    private readonly table: TableName,
    private readonly db: FakeDb
  ) {}

  select() {
    return this
  }

  returns() {
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value)
    return this
  }

  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]))
    return this
  }

  not(column: string, operator: string, value: unknown) {
    if (operator === "is" && value === null) {
      this.filters.push((row) => row[column] !== null)
      return this
    }
    if (operator === "in" && typeof value === "string") {
      const excluded = value.slice(1, -1).split(",")
      this.filters.push((row) => !excluded.includes(String(row[column])))
      return this
    }
    throw new Error(`Unsupported fake not filter ${column} ${operator}`)
  }

  maybeSingle() {
    this.wantsSingle = true
    return this
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: unknown
          error: null
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    const rows = this.db[this.table].filter((row) =>
      this.filters.every((filter) => filter(row))
    )
    const data = this.wantsSingle ? (rows[0] ?? null) : rows
    return Promise.resolve({ data, error: null }).then(onfulfilled, onrejected)
  }
}

class FakeSupabase {
  constructor(readonly db = new FakeDb()) {}
  readonly claimCalls: Record<string, unknown>[] = []
  readonly failCalls: Record<string, unknown>[] = []
  claimResult: Row | null = null

  from(table: TableName) {
    return new FakeQuery(table, this.db)
  }

  rpc(name: string, args: Record<string, unknown>) {
    if (name === "claim_review_run") {
      this.claimCalls.push(args)
      return Promise.resolve({
        data: this.claimResult ? [this.claimResult] : [],
        error: null,
      })
    }
    if (name === "fail_review_run") {
      this.failCalls.push(args)
      return Promise.resolve({
        data: [
          {
            review_run_id: args.p_review_run_id,
            review_cycle_id: "cycle-1",
            retried: true,
            next_review_run_id: "run-2",
            accepted: true,
          },
        ],
        error: null,
      })
    }
    throw new Error(`Unsupported fake rpc ${name}`)
  }
}

function hostRow(overrides: Row = {}): Row {
  return {
    id: "host-1",
    user_id: "user-1",
    display_name: "Host",
    setup_state: "ready",
    banned_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    last_seen_at: new Date().toISOString(),
    process_started_at: "2026-07-01T00:00:00.000Z",
    // Tracks the policy so raising the supported floor never silently turns
    // this shared fixture into an unsupported host.
    gentic_version: defaultHostCompatibilityPolicy.currentVersion,
    os: "linux",
    arch: "x64",
    configured_capacity: 1,
    provider_capabilities: { providers: {} },
    ...overrides,
  }
}

test("claims the next pending review run for an eligible host", async () => {
  const supabase = new FakeSupabase()
  supabase.db.hosts.push(hostRow())
  supabase.claimResult = {
    review_run_id: "run-1",
    review_cycle_id: "cycle-1",
    issue_id: "issue-1",
    pull_request_id: "pr-1",
    head_sha: "abc123",
  }

  const result = await claimNextReviewRun(supabase as never, "user-1", "host-1")

  assert.deepEqual(result, {
    id: "run-1",
    reviewCycleId: "cycle-1",
    issueId: "issue-1",
    pullRequestId: "pr-1",
    headSha: "abc123",
  })
  assert.deepEqual(supabase.claimCalls, [
    { p_host_id: "host-1", p_user_id: "user-1" },
  ])
})

test("capacity shared with implementation runs blocks a review claim", async () => {
  const supabase = new FakeSupabase()
  supabase.db.hosts.push(hostRow({ configured_capacity: 1 }))
  // An in-flight *implementation* run already fills the host's only slot —
  // proves review runs share one capacity pool with implementation issues.
  supabase.db.issues.push({
    active_host_id: "host-1",
    active_run_id: "run-0",
    status: "in-progress",
  })
  supabase.claimResult = {
    review_run_id: "run-1",
    review_cycle_id: "cycle-1",
    issue_id: "issue-1",
    pull_request_id: "pr-1",
    head_sha: "abc123",
  }

  const result = await claimNextReviewRun(supabase as never, "user-1", "host-1")

  assert.equal(result, null)
  assert.deepEqual(supabase.claimCalls, [])
})

test("offline host never claims a review run", async () => {
  const supabase = new FakeSupabase()
  supabase.db.hosts.push(hostRow({ last_seen_at: "2020-01-01T00:00:00.000Z" }))

  const result = await claimNextReviewRun(supabase as never, "user-1", "host-1")

  assert.equal(result, null)
  assert.deepEqual(supabase.claimCalls, [])
})

test("unsupported host version never claims a review run", async () => {
  const supabase = new FakeSupabase()
  supabase.db.hosts.push(hostRow({ gentic_version: "0.1.0" }))

  const result = await claimNextReviewRun(supabase as never, "user-1", "host-1")

  assert.equal(result, null)
})

test("a host that goes stale immediately after winning the claim is rolled back via fail_review_run", async () => {
  const supabase = new FakeSupabase()
  const host = hostRow()
  supabase.db.hosts.push(host)
  supabase.claimResult = {
    review_run_id: "run-1",
    review_cycle_id: "cycle-1",
    issue_id: "issue-1",
    pull_request_id: "pr-1",
    head_sha: "abc123",
  }

  // Simulate the host going stale between the claim and the post-claim
  // re-check by mutating its `last_seen_at` once the RPC has been called.
  const originalRpc = supabase.rpc.bind(supabase)
  supabase.rpc = (name, args) => {
    if (name === "claim_review_run") {
      host.last_seen_at = "2020-01-01T00:00:00.000Z"
    }
    return originalRpc(name, args)
  }

  const result = await claimNextReviewRun(supabase as never, "user-1", "host-1")

  assert.equal(result, null)
  assert.deepEqual(supabase.failCalls, [
    {
      p_review_run_id: "run-1",
      p_error: "Host became ineligible immediately after claim",
    },
  ])
})
