import assert from "node:assert/strict"
import { test } from "node:test"

import { ServiceError } from "./errors"
import {
  authenticateHostCredential,
  classifyHostVersion,
  createHost,
  createHostEnrollmentCode,
  banHost,
  deleteHost,
  exchangeHostEnrollmentCode,
  getHost,
  getHostControlState,
  hashHostSecret,
  listHosts,
  markHostOffline,
  recordHostHeartbeat,
  renameHost,
  unbanHost,
  updateHost,
  type HostDomain,
} from "./hosts"

type Row = Record<string, unknown>
type TableName =
  | "hosts"
  | "issues"
  | "messages"
  | "review_runs"
  | "host_enrollment_codes"
  | "host_enrollment_exchange_failures"

const now = new Date("2026-07-29T08:30:00.000Z")
const credentialHash = "a".repeat(64)

const capabilities = {
  providers: {
    claude_code: {
      enabled: true,
      available: true,
      authenticated: true,
      version: "5.0.0",
      models: ["claude-sonnet-5"],
      metadata: {
        path: "/Users/alice/.local/bin/claude",
        last_error: "token for alice failed from 192.0.2.1",
      },
    },
    codex: {
      enabled: true,
      available: false,
      authenticated: null,
      version: null,
      models: [],
      metadata: { reason: "not-installed" },
    },
  },
}

class FakeDb {
  hosts: Row[] = []
  issues: Row[] = []
  messages: Row[] = []
  review_runs: Row[] = []
  host_enrollment_codes: Row[] = []
  host_enrollment_exchange_failures: Row[] = []
}

class FakeSupabase {
  constructor(readonly db = new FakeDb()) {}

  from(table: TableName) {
    return new FakeQuery(table, this.db)
  }

  rpc(name: string, args: Record<string, unknown>) {
    if (name === "record_host_enrollment_exchange_failure") {
      return this.recordExchangeFailure(args)
    }
    if (name === "rename_host") {
      return this.renameHost(args)
    }
    if (name === "ban_host") {
      return this.banHost(args)
    }
    if (name === "unban_host") {
      return this.unbanHost(args)
    }
    if (name === "delete_host") {
      return this.deleteHost(args)
    }

    assert.equal(name, "consume_host_enrollment_code")
    const nowValue = String(args.p_now)
    const code = this.db.host_enrollment_codes.find(
      (row) =>
        row.code_hash === args.p_code_hash &&
        row.consumed_at === null &&
        new Date(String(row.expires_at)).getTime() >
          new Date(nowValue).getTime()
    )

    if (!code) {
      return new FakeRpcQuery(null)
    }

    code.consumed_at = nowValue
    const baseName = normalizeNameForDisplay(String(args.p_display_name))
    let displayName = baseName
    let suffix = 1
    while (
      this.db.hosts.some(
        (row) =>
          row.user_id === code.user_id &&
          row.normalized_name === normalizeName(displayName)
      )
    ) {
      suffix += 1
      displayName = `${baseName} ${suffix}`
    }

    const row = hostRow({
      id: `host-${this.db.hosts.length + 1}`,
      user_id: code.user_id,
      display_name: displayName,
      credential_hash: args.p_credential_hash,
      setup_state: "enrolling",
      gentic_version: args.p_gentic_version,
      os: args.p_os,
      arch: args.p_arch,
      configured_capacity: args.p_configured_capacity,
      provider_capabilities: args.p_provider_capabilities,
      process_started_at: args.p_process_started_at,
      last_seen_at: null,
      created_at: nowValue,
      updated_at: nowValue,
    })
    this.db.hosts.push(row)
    return new FakeRpcQuery(row)
  }

  private recordExchangeFailure(args: Record<string, unknown>) {
    const rateLimitKey = String(args.p_rate_limit_key)
    const nowValue = String(args.p_now)
    const nowMs = new Date(nowValue).getTime()
    const maxFailures = Number(args.p_max_failures)
    const windowMs = Number(args.p_window_ms)
    const existing = this.db.host_enrollment_exchange_failures.find(
      (row) => row.rate_limit_key === rateLimitKey
    )

    if (!existing) {
      const row = {
        rate_limit_key: rateLimitKey,
        failed_count: 1,
        window_started_at: nowValue,
        locked_until:
          maxFailures <= 1 ? new Date(nowMs + windowMs).toISOString() : null,
        updated_at: nowValue,
      }
      this.db.host_enrollment_exchange_failures.push(row)
      return new FakeRpcQuery(row)
    }

    const windowExpired =
      nowMs - new Date(String(existing.window_started_at)).getTime() >= windowMs
    const failedCount = windowExpired ? 1 : Number(existing.failed_count) + 1

    existing.failed_count = failedCount
    existing.window_started_at = windowExpired
      ? nowValue
      : existing.window_started_at
    existing.locked_until =
      failedCount >= maxFailures
        ? new Date(nowMs + windowMs).toISOString()
        : null
    existing.updated_at = nowValue

    return new FakeRpcQuery(existing)
  }

  private renameHost(args: Record<string, unknown>) {
    const userId = String(args.p_user_id)
    const hostId = String(args.p_host_id)
    const displayName = normalizeNameForDisplay(String(args.p_display_name))
    const nowValue = String(args.p_now)
    const host = this.db.hosts.find(
      (row) => row.id === hostId && row.user_id === userId
    )

    if (!host) {
      return new FakeRpcQuery(null)
    }
    if (
      this.db.hosts.some(
        (row) =>
          row.user_id === userId &&
          row.id !== hostId &&
          row.normalized_name === normalizeName(displayName)
      )
    ) {
      return new FakeRpcQuery(null, {
        code: "23505",
        message: "Host display name is already in use",
      })
    }

    host.display_name = displayName
    host.normalized_name = normalizeName(displayName)
    host.updated_at = nowValue
    return new FakeRpcQuery(host)
  }

  private banHost(args: Record<string, unknown>) {
    const host = this.findOwnedHost(args)
    if (!host) {
      return new FakeRpcQuery(null)
    }

    const nowValue = String(args.p_now)
    host.banned_at ??= nowValue
    host.last_seen_at = null
    host.updated_at = nowValue
    this.requeueHostActiveIssues(String(args.p_host_id), nowValue)
    return new FakeRpcQuery(host)
  }

  private unbanHost(args: Record<string, unknown>) {
    const host = this.findOwnedHost(args)
    if (!host) {
      return new FakeRpcQuery(null)
    }

    const nowValue = String(args.p_now)
    host.banned_at = null
    host.last_seen_at = null
    host.updated_at = nowValue
    return new FakeRpcQuery(host)
  }

  private deleteHost(args: Record<string, unknown>) {
    const host = this.findOwnedHost(args)
    if (!host) {
      return new FakeRpcQuery(false)
    }

    const nowValue = String(args.p_now)
    host.banned_at ??= nowValue
    host.last_seen_at = null
    host.credential_expires_at = nowValue
    host.updated_at = nowValue
    this.requeueHostActiveIssues(String(args.p_host_id), nowValue)
    this.db.hosts = this.db.hosts.filter((row) => row !== host)
    return new FakeRpcQuery(true)
  }

  private findOwnedHost(args: Record<string, unknown>) {
    return this.db.hosts.find(
      (row) => row.id === args.p_host_id && row.user_id === args.p_user_id
    )
  }

  private requeueHostActiveIssues(hostId: string, nowValue: string) {
    for (const issue of this.db.issues) {
      if (issue.active_host_id !== hostId || !issue.active_run_id) {
        continue
      }

      const runId = issue.active_run_id
      issue.active_host_id = null
      issue.active_run_id = null
      issue.updated_at = nowValue

      if (issue.status === "run-failed") {
        continue
      }

      issue.status = "todo"
      issue.run_error = null
      issue.run_started_at = null
      issue.run_finished_at = null
      issue.usage_limit_reset_at = null
      for (const message of this.db.messages) {
        if (
          message.issue_id === issue.id &&
          message.role === "user" &&
          message.consumed_by_run_id === runId
        ) {
          message.consumed_by_run_id = null
          message.consumed_at = null
          message.updated_at = nowValue
        }
      }
    }
  }
}

class FakeRpcQuery implements PromiseLike<{
  data: unknown
  error: { message: string; code?: string } | null
}> {
  constructor(
    private readonly data: Row | boolean | null,
    private readonly error: { message: string; code?: string } | null = null
  ) {}

  maybeSingle() {
    return this
  }

  single() {
    return this
  }

  returns() {
    return this
  }

  then<
    TResult1 = {
      data: unknown
      error: { message: string; code?: string } | null
    },
    TResult2 = never,
  >(
    onfulfilled?:
      | ((value: {
          data: unknown
          error: { message: string; code?: string } | null
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: this.data, error: this.error }).then(
      onfulfilled,
      onrejected
    )
  }
}

class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<(row: Row) => boolean> = []
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select"
  private payload: Row | null = null
  private wantsSingle = false
  private maybe = false

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

  order() {
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value)
    return this
  }

  is(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value)
    return this
  }

  neq(column: string, value: unknown) {
    this.filters.push((row) => row[column] !== value)
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

  insert(payload: Row) {
    this.op = "insert"
    this.payload = payload
    return this
  }

  upsert(payload: Row) {
    this.op = "upsert"
    this.payload = payload
    return this
  }

  update(payload: Row) {
    this.op = "update"
    this.payload = payload
    return this
  }

  delete() {
    this.op = "delete"
    return this
  }

  single() {
    this.wantsSingle = true
    return this
  }

  maybeSingle() {
    this.wantsSingle = true
    this.maybe = true
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
    return this.execute().then(onfulfilled, onrejected)
  }

  private rows(): Row[] {
    return this.db[this.table]
  }

  private matches(row: Row): boolean {
    return this.filters.every((filter) => filter(row))
  }

  private async execute(): Promise<{ data: unknown; error: null }> {
    if (this.op === "insert") {
      const row: Row = {
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
        ...this.payload,
      }
      if (this.table === "hosts") {
        row.id = row.id ?? `host-${this.rows().length + 1}`
        row.normalized_name = normalizeName(String(row.display_name))
      }
      if (this.table === "host_enrollment_codes") {
        row.consumed_at = row.consumed_at ?? null
      }
      this.rows().push(row)
      return { data: this.wantsSingle ? row : [row], error: null }
    }

    if (this.op === "upsert") {
      const key =
        this.table === "host_enrollment_exchange_failures"
          ? "rate_limit_key"
          : "id"
      const existing = this.rows().find(
        (row) => row[key] === this.payload?.[key]
      )
      if (existing) {
        Object.assign(existing, this.payload)
        return { data: this.wantsSingle ? existing : [existing], error: null }
      }
      const row = { ...this.payload }
      this.rows().push(row)
      return { data: this.wantsSingle ? row : [row], error: null }
    }

    if (this.op === "update") {
      const matched = this.rows().filter((row) => this.matches(row))
      for (const row of matched) {
        Object.assign(row, this.payload)
        if (this.payload && "display_name" in this.payload) {
          row.normalized_name = normalizeName(String(this.payload.display_name))
        }
      }
      return {
        data: this.wantsSingle ? (matched[0] ?? null) : matched,
        error: null,
      }
    }

    if (this.op === "delete") {
      const kept = this.rows().filter((row) => !this.matches(row))
      this.db[this.table] = kept
      return { data: null, error: null }
    }

    const matched = this.rows()
      .filter((row) => this.matches(row))
      .map((row) => ({ ...row }))

    return {
      data: this.wantsSingle
        ? (matched[0] ?? (this.maybe ? null : undefined))
        : matched,
      error: null,
    }
  }
}

test("listHosts and getHost are scoped to the owner", async () => {
  const supabase = new FakeSupabase()
  supabase.db.hosts.push(
    hostRow({ id: "host-1", user_id: "user-1", display_name: "Mine" }),
    hostRow({ id: "host-2", user_id: "user-2", display_name: "Theirs" })
  )

  const hosts = await listHosts(supabase as never, "user-1", { now })
  assert.deepEqual(
    hosts.map((host) => host.id),
    ["host-1"]
  )

  await assert.rejects(
    getHost(supabase as never, "user-1", "host-2", { now }),
    (error) =>
      error instanceof ServiceError &&
      error.code === "not_found" &&
      error.message === "Host not found"
  )
})

test("createHost and updateHost validate unique case-insensitive names per user", async () => {
  const supabase = new FakeSupabase()

  await createHost(
    supabase as never,
    "user-1",
    {
      display_name: " Alpha   Host ",
      credential_hash: credentialHash,
    },
    { now }
  )

  await assert.rejects(
    createHost(
      supabase as never,
      "user-1",
      {
        display_name: "alpha host",
        credential_hash: credentialHash,
      },
      { now }
    ),
    (error) => error instanceof ServiceError && error.code === "validation"
  )

  await createHost(
    supabase as never,
    "user-2",
    {
      display_name: "alpha host",
      credential_hash: credentialHash,
    },
    { now }
  )

  await assert.rejects(
    createHost(
      supabase as never,
      "user-1",
      {
        display_name: "x".repeat(81),
        credential_hash: credentialHash,
      },
      { now }
    ),
    (error) =>
      error instanceof ServiceError &&
      error.code === "validation" &&
      error.message.includes("1 and 80")
  )

  const renamed = await updateHost(
    supabase as never,
    "user-1",
    "host-1",
    { display_name: "Beta Host" },
    { now }
  )
  assert.equal(renamed.display_name, "Beta Host")
})

test("renameHost enforces owner scoped case-insensitive names", async () => {
  const supabase = new FakeSupabase()
  supabase.db.hosts.push(
    hostRow({ id: "host-1", user_id: "user-1", display_name: "Build A" }),
    hostRow({ id: "host-2", user_id: "user-1", display_name: "Build B" }),
    hostRow({ id: "host-3", user_id: "user-2", display_name: "Build C" })
  )

  const renamed = await renameHost(
    supabase as never,
    "user-1",
    "host-1",
    { display_name: " Build   C " },
    { now }
  )
  assert.equal(renamed.display_name, "Build C")

  await assert.rejects(
    renameHost(
      supabase as never,
      "user-1",
      "host-1",
      { display_name: "build b" },
      { now }
    ),
    (error) =>
      error instanceof ServiceError &&
      error.code === "validation" &&
      error.message === "Host display name is already in use"
  )

  await assert.rejects(
    renameHost(
      supabase as never,
      "user-1",
      "host-3",
      { display_name: "Hidden" },
      { now }
    ),
    (error) => error instanceof ServiceError && error.code === "not_found"
  )
})

test("primary state derives setup, heartbeat boundary, and banned precedence", async () => {
  const supabase = new FakeSupabase()
  supabase.db.hosts.push(
    hostRow({
      id: "setup",
      setup_state: "setup_failed",
      last_seen_at: now.toISOString(),
    }),
    hostRow({
      id: "online",
      last_seen_at: new Date(now.getTime() - 90_000).toISOString(),
    }),
    hostRow({
      id: "offline",
      last_seen_at: new Date(now.getTime() - 90_001).toISOString(),
    }),
    hostRow({
      id: "banned",
      banned_at: now.toISOString(),
      setup_state: "setup_failed",
      last_seen_at: now.toISOString(),
    })
  )

  const states = await listHosts(supabase as never, "user-1", { now })
  assert.equal(stateById(states, "setup"), "setup-incomplete")
  assert.equal(stateById(states, "online"), "online")
  assert.equal(stateById(states, "offline"), "offline")
  assert.equal(stateById(states, "banned"), "banned")
})

test("explicit offline time is clock-controlled and a heartbeat clears it", async () => {
  const supabase = new FakeSupabase()
  supabase.db.hosts.push(
    hostRow({
      id: "host-1",
      last_seen_at: now.toISOString(),
      offline_since_at: null,
    })
  )

  const offlineAt = new Date(now.getTime() + 30_000)
  await markHostOffline(supabase as never, "user-1", "host-1", {
    now: offlineAt,
  })

  assert.equal(supabase.db.hosts[0]?.last_seen_at, null)
  assert.equal(
    supabase.db.hosts[0]?.offline_since_at,
    offlineAt.toISOString()
  )

  const reconnectedAt = new Date(now.getTime() + 60_000)
  await recordHostHeartbeat(
    supabase as never,
    "user-1",
    "host-1",
    { ...telemetry(), setup_completed: true },
    { now: reconnectedAt }
  )

  assert.equal(
    supabase.db.hosts[0]?.last_seen_at,
    reconnectedAt.toISOString()
  )
  assert.equal(supabase.db.hosts[0]?.offline_since_at, null)
})

test("classifyHostVersion applies a centralized compatibility policy", () => {
  const policy = {
    minimumSupportedVersion: "0.10.0",
    currentVersion: "0.14.0",
  }

  assert.equal(classifyHostVersion("0.14.0", policy), "current")
  assert.equal(classifyHostVersion("0.12.0", policy), "update-available")
  assert.equal(classifyHostVersion("0.9.9", policy), "unsupported")
  assert.equal(classifyHostVersion(null, policy), "unsupported")
})

test("provider readiness exposes only approved structured metadata", async () => {
  const supabase = new FakeSupabase()
  supabase.db.hosts.push(
    hostRow({
      id: "host-1",
      provider_capabilities: capabilities,
    })
  )

  const host = await getHost(supabase as never, "user-1", "host-1", {
    now,
  })

  assert.deepEqual(host.providers, {
    claude_code: {
      installed: true,
      authenticated: true,
      version: "5.0.0",
    },
    codex: {
      installed: false,
      authenticated: null,
      version: null,
    },
  })
  assert.equal(JSON.stringify(host).includes("/Users/alice"), false)
  assert.equal(JSON.stringify(host).includes("192.0.2.1"), false)
})

test("running task count is derived from active issue assignments", async () => {
  const supabase = new FakeSupabase()
  supabase.db.hosts.push(
    hostRow({ id: "host-1", configured_capacity: 4 }),
    hostRow({ id: "host-2", configured_capacity: 1 })
  )
  supabase.db.issues.push(
    {
      id: "issue-1",
      active_host_id: "host-1",
      active_run_id: "run-1",
      status: "queued",
    },
    {
      id: "issue-2",
      active_host_id: "host-1",
      active_run_id: "run-2",
      status: "in-progress",
    },
    {
      id: "issue-3",
      active_host_id: "host-1",
      active_run_id: null,
      status: "completed",
    },
    {
      id: "issue-4",
      active_host_id: "host-2",
      active_run_id: null,
      status: "cancelled",
    },
    {
      id: "issue-5",
      active_host_id: "host-1",
      active_run_id: null,
      status: "todo",
    }
  )

  const host = await getHost(supabase as never, "user-1", "host-1", {
    now,
  })

  assert.equal(host.configured_capacity, 4)
  assert.equal(host.running_task_count, 2)
})

test("running task count includes claimed review runs sharing the same capacity pool", async () => {
  const supabase = new FakeSupabase()
  supabase.db.hosts.push(
    hostRow({ id: "host-1", configured_capacity: 4 })
  )
  supabase.db.issues.push({
    id: "issue-1",
    active_host_id: "host-1",
    active_run_id: "run-1",
    status: "in-progress",
  })
  supabase.db.review_runs.push(
    { id: "review-run-1", claimed_by_host_id: "host-1", status: "running" },
    // A completed review run no longer holds the host's capacity.
    {
      id: "review-run-2",
      claimed_by_host_id: "host-1",
      status: "completed",
    }
  )

  const host = await getHost(supabase as never, "user-1", "host-1", {
    now,
  })

  assert.equal(host.running_task_count, 2)
})

test("host control ignores orphaned assignments without an active run", async () => {
  const supabase = new FakeSupabase()
  supabase.db.issues.push(
    issueRow({
      id: "active",
      active_host_id: "host-1",
      active_run_id: "run-1",
      status: "in-progress",
    }),
    issueRow({
      id: "orphan",
      active_host_id: "host-1",
      active_run_id: null,
      status: "todo",
    })
  )

  assert.deepEqual(
    await getHostControlState(supabase as never, "host-1", false),
    {
      host: { banned: false },
      runs: [
        {
          issue_id: "active",
          active_run_id: "run-1",
          status: "in-progress",
        },
      ],
      review_runs: [],
    }
  )
})

test("host control includes the host's claimed running review runs", async () => {
  const supabase = new FakeSupabase()
  supabase.db.review_runs.push(
    { id: "review-run-1", claimed_by_host_id: "host-1", status: "running" },
    // Terminal and another host's claim are both excluded.
    {
      id: "review-run-2",
      claimed_by_host_id: "host-1",
      status: "completed",
    },
    { id: "review-run-3", claimed_by_host_id: "host-2", status: "running" }
  )

  assert.deepEqual(
    await getHostControlState(supabase as never, "host-1", false),
    {
      host: { banned: false },
      runs: [],
      review_runs: [{ review_run_id: "review-run-1", status: "running" }],
    }
  )
})

test("ban revokes access and atomically requeues active work", async () => {
  const supabase = new FakeSupabase()
  const credential = `gtwc_${"a".repeat(43)}`
  supabase.db.hosts.push(
    hostRow({
      id: "host-1",
      credential_hash: hashHostSecret(credential),
    })
  )
  supabase.db.issues.push(
    issueRow({
      id: "issue-1",
      active_host_id: "host-1",
      active_run_id: "11111111-1111-4111-8111-111111111111",
      status: "in-progress",
      session_id: "session-1",
      run_error: "old",
    })
  )
  supabase.db.messages.push({
    id: "message-1",
    issue_id: "issue-1",
    role: "user",
    consumed_by_run_id: "11111111-1111-4111-8111-111111111111",
    consumed_at: now.toISOString(),
  })

  const banned = await banHost(supabase as never, "user-1", "host-1", {
    now,
  })

  assert.equal(banned.primary_state, "banned")
  await assert.rejects(
    authenticateHostCredential(supabase as never, credential, { now }),
    (error) => error instanceof ServiceError && error.code === "forbidden"
  )
  assert.equal(supabase.db.issues[0]?.status, "todo")
  assert.equal(supabase.db.issues[0]?.active_host_id, null)
  assert.equal(supabase.db.issues[0]?.active_run_id, null)
  assert.equal(supabase.db.issues[0]?.session_id, "session-1")
  assert.equal(supabase.db.issues[0]?.run_error, null)
  assert.equal(supabase.db.messages[0]?.consumed_by_run_id, null)
  assert.equal(supabase.db.messages[0]?.consumed_at, null)
})

test("stale host writes after ban cannot restore online state", async () => {
  const supabase = new FakeSupabase()
  supabase.db.hosts.push(hostRow({ id: "host-1" }))

  await banHost(supabase as never, "user-1", "host-1", { now })

  await assert.rejects(
    updateHost(
      supabase as never,
      "user-1",
      "host-1",
      { last_seen_at: now.toISOString() },
      { now, requireUnbanned: true }
    ),
    (error) => error instanceof ServiceError && error.code === "not_found"
  )
  assert.equal(supabase.db.hosts[0]?.last_seen_at, null)
})

test("unban restores host identity and credential without old leases", async () => {
  const supabase = new FakeSupabase()
  const credential = `gtwc_${"b".repeat(43)}`
  supabase.db.hosts.push(
    hostRow({
      id: "host-1",
      credential_hash: hashHostSecret(credential),
    })
  )
  supabase.db.issues.push(
    issueRow({
      id: "issue-1",
      active_host_id: "host-1",
      active_run_id: "22222222-2222-4222-8222-222222222222",
    })
  )

  await banHost(supabase as never, "user-1", "host-1", { now })
  const unbanned = await unbanHost(supabase as never, "user-1", "host-1", {
    now,
  })

  assert.equal(unbanned.id, "host-1")
  assert.equal(unbanned.banned_at, null)
  assert.deepEqual(
    await authenticateHostCredential(supabase as never, credential, { now }),
    { userId: "user-1", hostId: "host-1", banned: false }
  )
  assert.equal(supabase.db.issues[0]?.active_host_id, null)
  assert.equal(supabase.db.issues[0]?.active_run_id, null)
})

test("delete revokes credentials, hard deletes hosts, and requeues online work", async () => {
  const supabase = new FakeSupabase()
  const credential = `gtwc_${"c".repeat(43)}`
  supabase.db.hosts.push(
    hostRow({
      id: "host-1",
      credential_hash: hashHostSecret(credential),
    })
  )
  supabase.db.issues.push(
    issueRow({
      id: "issue-1",
      active_host_id: "host-1",
      active_run_id: "33333333-3333-4333-8333-333333333333",
      status: "queued",
    })
  )

  await deleteHost(supabase as never, "user-1", "host-1", { now })

  assert.equal(supabase.db.hosts.length, 0)
  assert.equal(supabase.db.issues[0]?.status, "todo")
  assert.equal(supabase.db.issues[0]?.active_host_id, null)
  assert.equal(supabase.db.issues[0]?.active_run_id, null)
  await assert.rejects(
    authenticateHostCredential(supabase as never, credential, { now }),
    (error) => error instanceof ServiceError && error.code === "forbidden"
  )
})

test("offline delete does not retry tasks already marked run-failed", async () => {
  const supabase = new FakeSupabase()
  supabase.db.hosts.push(
    hostRow({
      id: "host-1",
      last_seen_at: new Date(now.getTime() - 120_000).toISOString(),
    })
  )
  supabase.db.issues.push(
    issueRow({
      id: "issue-1",
      active_host_id: "host-1",
      active_run_id: "44444444-4444-4444-8444-444444444444",
      status: "run-failed",
      run_error: "failed",
    })
  )

  await deleteHost(supabase as never, "user-1", "host-1", { now })

  assert.equal(supabase.db.issues[0]?.status, "run-failed")
  assert.equal(supabase.db.issues[0]?.run_error, "failed")
  assert.equal(supabase.db.issues[0]?.active_host_id, null)
  assert.equal(supabase.db.issues[0]?.active_run_id, null)
})

test("createHostEnrollmentCode expires in 10 minutes and replaces active codes", async () => {
  const supabase = new FakeSupabase()

  const first = await createHostEnrollmentCode(supabase as never, "user-1", {
    now,
  })
  const second = await createHostEnrollmentCode(supabase as never, "user-1", {
    now: new Date(now.getTime() + 1000),
  })

  assert.match(first.code, /^gtce_/)
  assert.equal(
    first.expires_at,
    new Date(now.getTime() + 10 * 60 * 1000).toISOString()
  )
  assert.notEqual(first.code, second.code)
  assert.equal(supabase.db.host_enrollment_codes.length, 2)
  assert.equal(
    supabase.db.host_enrollment_codes[0]?.consumed_at,
    new Date(now.getTime() + 1000).toISOString()
  )
  assert.notEqual(supabase.db.host_enrollment_codes[0]?.code_hash, first.code)
})

test("exchange consumes a code once, resolves name collisions, and returns credential once", async () => {
  const supabase = new FakeSupabase()
  supabase.db.hosts.push(hostRow({ display_name: "Build Host" }))
  const enrollment = await createHostEnrollmentCode(
    supabase as never,
    "user-1",
    { now }
  )

  const result = await exchangeHostEnrollmentCode(
    supabase as never,
    {
      code: enrollment.code,
      display_name: "Build Host",
      telemetry: telemetry(),
    },
    { now, rateLimitKey: "198.51.100.1:test" }
  )

  assert.match(result.credential, /^gtwc_/)
  assert.equal(result.host.display_name, "Build Host 2")
  assert.equal(result.host.primary_state, "setup-incomplete")
  assert.equal(
    supabase.db.hosts.at(-1)?.credential_hash,
    hashHostSecret(result.credential)
  )

  await assert.rejects(
    exchangeHostEnrollmentCode(
      supabase as never,
      {
        code: enrollment.code,
        display_name: "Build Host",
        telemetry: telemetry(),
      },
      { now, rateLimitKey: "198.51.100.1:test" }
    ),
    (error) =>
      error instanceof ServiceError &&
      error.code === "validation" &&
      error.message === "Invalid enrollment code"
  )
})

test("exchange rejects expired codes and rate-limits repeated failures", async () => {
  const supabase = new FakeSupabase()
  const enrollment = await createHostEnrollmentCode(
    supabase as never,
    "user-1",
    { now }
  )
  const later = new Date(now.getTime() + 11 * 60 * 1000)

  await assert.rejects(
    exchangeHostEnrollmentCode(
      supabase as never,
      {
        code: enrollment.code,
        display_name: "Host",
        telemetry: telemetry(),
      },
      { now: later, rateLimitKey: "203.0.113.10:test" }
    ),
    (error) => error instanceof ServiceError && error.code === "validation"
  )

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(
      exchangeHostEnrollmentCode(
        supabase as never,
        {
          code: `gtce_${"x".repeat(43)}`,
          display_name: "Host",
          telemetry: telemetry(),
        },
        { now, rateLimitKey: "203.0.113.20:test" }
      )
    )
  }

  await exchangeHostEnrollmentCode(
    supabase as never,
    {
      code: enrollment.code,
      display_name: "Host",
      telemetry: telemetry(),
    },
    { now, rateLimitKey: "203.0.113.20:test" }
  )

  const next = await createHostEnrollmentCode(supabase as never, "user-1", {
    now,
  })
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(
      exchangeHostEnrollmentCode(
        supabase as never,
        {
          code: `gtce_${"x".repeat(43)}`,
          display_name: "Host",
          telemetry: telemetry(),
        },
        { now, rateLimitKey: "203.0.113.30:test" }
      )
    )
  }
  await assert.rejects(
    exchangeHostEnrollmentCode(
      supabase as never,
      {
        code: next.code,
        display_name: "Host",
        telemetry: telemetry(),
      },
      { now, rateLimitKey: "203.0.113.30:test" }
    ),
    (error) => error instanceof ServiceError && error.code === "rate_limited"
  )
})

test("authenticateHostCredential isolates credentials and rejects malformed, banned, deleted, and expired credentials", async () => {
  const supabase = new FakeSupabase()
  const credential1 = `gtwc_${"a".repeat(43)}`
  const credential2 = `gtwc_${"b".repeat(43)}`
  const bannedCredential = `gtwc_${"c".repeat(43)}`
  const expiredCredential = `gtwc_${"d".repeat(43)}`
  supabase.db.hosts.push(
    hostRow({
      id: "host-1",
      user_id: "user-1",
      credential_hash: hashHostSecret(credential1),
      credential_expires_at: null,
    }),
    hostRow({
      id: "host-2",
      user_id: "user-2",
      credential_hash: hashHostSecret(credential2),
      credential_expires_at: null,
    }),
    hostRow({
      id: "host-3",
      user_id: "user-1",
      banned_at: now.toISOString(),
      credential_hash: hashHostSecret(bannedCredential),
      credential_expires_at: null,
    }),
    hostRow({
      id: "host-4",
      user_id: "user-1",
      credential_hash: hashHostSecret(expiredCredential),
      credential_expires_at: new Date(now.getTime() - 1).toISOString(),
    })
  )

  assert.deepEqual(
    await authenticateHostCredential(supabase as never, credential1, { now }),
    { userId: "user-1", hostId: "host-1", banned: false }
  )
  assert.deepEqual(
    await authenticateHostCredential(supabase as never, credential2, { now }),
    { userId: "user-2", hostId: "host-2", banned: false }
  )

  for (const credential of [
    "not-a-host-credential",
    bannedCredential,
    expiredCredential,
    `gtwc_${"e".repeat(43)}`,
  ]) {
    await assert.rejects(
      authenticateHostCredential(supabase as never, credential, { now }),
      (error) => error instanceof ServiceError && error.code === "forbidden"
    )
  }

  assert.deepEqual(
    await authenticateHostCredential(supabase as never, bannedCredential, {
      now,
      allowBanned: true,
    }),
    { userId: "user-1", hostId: "host-3", banned: true }
  )
})

function stateById(hosts: HostDomain[], id: string) {
  const host = hosts.find((candidate) => candidate.id === id)
  assert.ok(host)
  return host.primary_state
}

function hostRow(overrides: Row = {}): Row {
  const displayName = String(overrides.display_name ?? "Host")
  return {
    id: "host-1",
    user_id: "user-1",
    display_name: displayName,
    normalized_name: normalizeName(displayName),
    credential_expires_at: null,
    setup_state: "ready",
    banned_at: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    last_seen_at: now.toISOString(),
    process_started_at: now.toISOString(),
    gentic_version: "0.14.0",
    os: "linux",
    arch: "x64",
    configured_capacity: 1,
    provider_capabilities: { providers: {} },
    ...overrides,
  }
}

function issueRow(overrides: Row = {}): Row {
  return {
    id: "issue-1",
    active_host_id: null,
    active_run_id: null,
    status: "todo",
    session_id: null,
    run_error: null,
    run_started_at: null,
    run_finished_at: null,
    usage_limit_reset_at: null,
    updated_at: now.toISOString(),
    ...overrides,
  }
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase()
}

function normalizeNameForDisplay(value: string): string {
  return value.trim().replace(/\s+/g, " ")
}

function telemetry() {
  return {
    gentic_version: "0.14.0",
    os: "linux",
    arch: "x64",
    configured_capacity: 1,
    provider_capabilities: { providers: {} },
    process_started_at: now.toISOString(),
  }
}
