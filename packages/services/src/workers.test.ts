import assert from "node:assert/strict"
import { test } from "node:test"

import { ServiceError } from "./errors"
import {
  authenticateWorkerCredential,
  classifyWorkerVersion,
  createWorker,
  createWorkerEnrollmentCode,
  exchangeWorkerEnrollmentCode,
  getWorker,
  hashWorkerSecret,
  listWorkers,
  updateWorker,
  type WorkerDomain,
} from "./workers"

type Row = Record<string, unknown>
type TableName =
  | "workers"
  | "issues"
  | "worker_enrollment_codes"
  | "worker_enrollment_exchange_failures"

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
  workers: Row[] = []
  issues: Row[] = []
  worker_enrollment_codes: Row[] = []
  worker_enrollment_exchange_failures: Row[] = []
}

class FakeSupabase {
  constructor(readonly db = new FakeDb()) {}

  from(table: TableName) {
    return new FakeQuery(table, this.db)
  }

  rpc(name: string, args: Record<string, unknown>) {
    assert.equal(name, "consume_worker_enrollment_code")
    const nowValue = String(args.p_now)
    const code = this.db.worker_enrollment_codes.find(
      (row) =>
        row.code_hash === args.p_code_hash &&
        row.consumed_at === null &&
        new Date(String(row.expires_at)).getTime() > new Date(nowValue).getTime()
    )

    if (!code) {
      return new FakeRpcQuery(null)
    }

    code.consumed_at = nowValue
    const baseName = normalizeNameForDisplay(String(args.p_display_name))
    let displayName = baseName
    let suffix = 1
    while (
      this.db.workers.some(
        (row) =>
          row.user_id === code.user_id &&
          row.normalized_name === normalizeName(displayName)
      )
    ) {
      suffix += 1
      displayName = `${baseName} ${suffix}`
    }

    const row = workerRow({
      id: `worker-${this.db.workers.length + 1}`,
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
    this.db.workers.push(row)
    return new FakeRpcQuery(row)
  }
}

class FakeRpcQuery implements PromiseLike<{ data: unknown; error: null }> {
  constructor(private readonly data: Row | null) {}

  maybeSingle() {
    return this
  }

  returns() {
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
    return Promise.resolve({ data: this.data, error: null }).then(
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
      if (this.table === "workers") {
        row.id = row.id ?? `worker-${this.rows().length + 1}`
        row.normalized_name = normalizeName(String(row.display_name))
      }
      if (this.table === "worker_enrollment_codes") {
        row.consumed_at = row.consumed_at ?? null
      }
      this.rows().push(row)
      return { data: this.wantsSingle ? row : [row], error: null }
    }

    if (this.op === "upsert") {
      const key =
        this.table === "worker_enrollment_exchange_failures"
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
        ? matched[0] ?? (this.maybe ? null : undefined)
        : matched,
      error: null,
    }
  }
}

test("listWorkers and getWorker are scoped to the owner", async () => {
  const supabase = new FakeSupabase()
  supabase.db.workers.push(
    workerRow({ id: "worker-1", user_id: "user-1", display_name: "Mine" }),
    workerRow({ id: "worker-2", user_id: "user-2", display_name: "Theirs" })
  )

  const workers = await listWorkers(supabase as never, "user-1", { now })
  assert.deepEqual(
    workers.map((worker) => worker.id),
    ["worker-1"]
  )

  await assert.rejects(
    getWorker(supabase as never, "user-1", "worker-2", { now }),
    (error) =>
      error instanceof ServiceError &&
      error.code === "not_found" &&
      error.message === "Worker not found"
  )
})

test("createWorker and updateWorker validate unique case-insensitive names per user", async () => {
  const supabase = new FakeSupabase()

  await createWorker(
    supabase as never,
    "user-1",
    {
      display_name: " Alpha   Worker ",
      credential_hash: credentialHash,
    },
    { now }
  )

  await assert.rejects(
    createWorker(
      supabase as never,
      "user-1",
      {
        display_name: "alpha worker",
        credential_hash: credentialHash,
      },
      { now }
    ),
    (error) => error instanceof ServiceError && error.code === "validation"
  )

  await createWorker(
    supabase as never,
    "user-2",
    {
      display_name: "alpha worker",
      credential_hash: credentialHash,
    },
    { now }
  )

  await assert.rejects(
    createWorker(
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

  const renamed = await updateWorker(
    supabase as never,
    "user-1",
    "worker-1",
    { display_name: "Beta Worker" },
    { now }
  )
  assert.equal(renamed.display_name, "Beta Worker")
})

test("primary state derives setup, heartbeat boundary, and banned precedence", async () => {
  const supabase = new FakeSupabase()
  supabase.db.workers.push(
    workerRow({
      id: "setup",
      setup_state: "setup_failed",
      last_seen_at: now.toISOString(),
    }),
    workerRow({
      id: "online",
      last_seen_at: new Date(now.getTime() - 90_000).toISOString(),
    }),
    workerRow({
      id: "offline",
      last_seen_at: new Date(now.getTime() - 90_001).toISOString(),
    }),
    workerRow({
      id: "banned",
      banned_at: now.toISOString(),
      setup_state: "setup_failed",
      last_seen_at: now.toISOString(),
    })
  )

  const states = await listWorkers(supabase as never, "user-1", { now })
  assert.equal(stateById(states, "setup"), "setup-incomplete")
  assert.equal(stateById(states, "online"), "online")
  assert.equal(stateById(states, "offline"), "offline")
  assert.equal(stateById(states, "banned"), "banned")
})

test("classifyWorkerVersion applies a centralized compatibility policy", () => {
  const policy = {
    minimumSupportedVersion: "0.10.0",
    currentVersion: "0.14.0",
  }

  assert.equal(classifyWorkerVersion("0.14.0", policy), "current")
  assert.equal(classifyWorkerVersion("0.12.0", policy), "update-available")
  assert.equal(classifyWorkerVersion("0.9.9", policy), "unsupported")
  assert.equal(classifyWorkerVersion(null, policy), "unsupported")
})

test("provider readiness exposes only approved structured metadata", async () => {
  const supabase = new FakeSupabase()
  supabase.db.workers.push(
    workerRow({
      id: "worker-1",
      provider_capabilities: capabilities,
    })
  )

  const worker = await getWorker(supabase as never, "user-1", "worker-1", {
    now,
  })

  assert.deepEqual(worker.providers, {
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
  assert.equal(JSON.stringify(worker).includes("/Users/alice"), false)
  assert.equal(JSON.stringify(worker).includes("192.0.2.1"), false)
})

test("running task count is derived from active issue assignments", async () => {
  const supabase = new FakeSupabase()
  supabase.db.workers.push(
    workerRow({ id: "worker-1", configured_capacity: 4 }),
    workerRow({ id: "worker-2", configured_capacity: 1 })
  )
  supabase.db.issues.push(
    { id: "issue-1", active_worker_id: "worker-1", status: "queued" },
    { id: "issue-2", active_worker_id: "worker-1", status: "in-progress" },
    { id: "issue-3", active_worker_id: "worker-1", status: "completed" },
    { id: "issue-4", active_worker_id: "worker-2", status: "cancelled" }
  )

  const worker = await getWorker(supabase as never, "user-1", "worker-1", {
    now,
  })

  assert.equal(worker.configured_capacity, 4)
  assert.equal(worker.running_task_count, 2)
})

test("createWorkerEnrollmentCode expires in 10 minutes and replaces active codes", async () => {
  const supabase = new FakeSupabase()

  const first = await createWorkerEnrollmentCode(supabase as never, "user-1", {
    now,
  })
  const second = await createWorkerEnrollmentCode(supabase as never, "user-1", {
    now: new Date(now.getTime() + 1000),
  })

  assert.match(first.code, /^gtce_/)
  assert.equal(
    first.expires_at,
    new Date(now.getTime() + 10 * 60 * 1000).toISOString()
  )
  assert.notEqual(first.code, second.code)
  assert.equal(supabase.db.worker_enrollment_codes.length, 2)
  assert.equal(
    supabase.db.worker_enrollment_codes[0]?.consumed_at,
    new Date(now.getTime() + 1000).toISOString()
  )
  assert.notEqual(supabase.db.worker_enrollment_codes[0]?.code_hash, first.code)
})

test("exchange consumes a code once, resolves name collisions, and returns credential once", async () => {
  const supabase = new FakeSupabase()
  supabase.db.workers.push(workerRow({ display_name: "Build Host" }))
  const enrollment = await createWorkerEnrollmentCode(
    supabase as never,
    "user-1",
    { now }
  )

  const result = await exchangeWorkerEnrollmentCode(
    supabase as never,
    {
      code: enrollment.code,
      display_name: "Build Host",
      telemetry: telemetry(),
    },
    { now, rateLimitKey: "198.51.100.1:test" }
  )

  assert.match(result.credential, /^gtwc_/)
  assert.equal(result.worker.display_name, "Build Host 2")
  assert.equal(result.worker.primary_state, "setup-incomplete")
  assert.equal(
    supabase.db.workers.at(-1)?.credential_hash,
    hashWorkerSecret(result.credential)
  )

  await assert.rejects(
    exchangeWorkerEnrollmentCode(
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
  const enrollment = await createWorkerEnrollmentCode(
    supabase as never,
    "user-1",
    { now }
  )
  const later = new Date(now.getTime() + 11 * 60 * 1000)

  await assert.rejects(
    exchangeWorkerEnrollmentCode(
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
      exchangeWorkerEnrollmentCode(
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

  await exchangeWorkerEnrollmentCode(
    supabase as never,
    {
      code: enrollment.code,
      display_name: "Host",
      telemetry: telemetry(),
    },
    { now, rateLimitKey: "203.0.113.20:test" }
  )

  const next = await createWorkerEnrollmentCode(supabase as never, "user-1", {
    now,
  })
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(
      exchangeWorkerEnrollmentCode(
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
    exchangeWorkerEnrollmentCode(
      supabase as never,
      {
        code: next.code,
        display_name: "Host",
        telemetry: telemetry(),
      },
      { now, rateLimitKey: "203.0.113.30:test" }
    ),
    (error) => error instanceof ServiceError && error.code === "validation"
  )
})

test("authenticateWorkerCredential isolates credentials and rejects malformed, banned, deleted, and expired credentials", async () => {
  const supabase = new FakeSupabase()
  const credential1 = `gtwc_${"a".repeat(43)}`
  const credential2 = `gtwc_${"b".repeat(43)}`
  const bannedCredential = `gtwc_${"c".repeat(43)}`
  const expiredCredential = `gtwc_${"d".repeat(43)}`
  supabase.db.workers.push(
    workerRow({
      id: "worker-1",
      user_id: "user-1",
      credential_hash: hashWorkerSecret(credential1),
      credential_expires_at: null,
    }),
    workerRow({
      id: "worker-2",
      user_id: "user-2",
      credential_hash: hashWorkerSecret(credential2),
      credential_expires_at: null,
    }),
    workerRow({
      id: "worker-3",
      user_id: "user-1",
      banned_at: now.toISOString(),
      credential_hash: hashWorkerSecret(bannedCredential),
      credential_expires_at: null,
    }),
    workerRow({
      id: "worker-4",
      user_id: "user-1",
      credential_hash: hashWorkerSecret(expiredCredential),
      credential_expires_at: new Date(now.getTime() - 1).toISOString(),
    })
  )

  assert.deepEqual(
    await authenticateWorkerCredential(supabase as never, credential1, { now }),
    { userId: "user-1", workerId: "worker-1" }
  )
  assert.deepEqual(
    await authenticateWorkerCredential(supabase as never, credential2, { now }),
    { userId: "user-2", workerId: "worker-2" }
  )

  for (const credential of [
    "not-a-worker-credential",
    bannedCredential,
    expiredCredential,
    `gtwc_${"e".repeat(43)}`,
  ]) {
    await assert.rejects(
      authenticateWorkerCredential(supabase as never, credential, { now }),
      (error) => error instanceof ServiceError && error.code === "forbidden"
    )
  }
})

function stateById(workers: WorkerDomain[], id: string) {
  const worker = workers.find((candidate) => candidate.id === id)
  assert.ok(worker)
  return worker.primary_state
}

function workerRow(overrides: Row = {}): Row {
  const displayName = String(overrides.display_name ?? "Worker")
  return {
    id: "worker-1",
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
