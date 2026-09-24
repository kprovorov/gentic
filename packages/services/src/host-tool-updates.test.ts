import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "./errors"
import {
  claimHostToolUpdate,
  createHostToolUpdate,
  expireHostToolUpdates,
  HOST_TOOL_UPDATE_RETENTION_MS,
  HOST_TOOL_UPDATE_TTL_MS,
  hostToolUpdateIneligibilityReason,
  listHostToolUpdates,
  reportHostToolUpdateResult,
} from "./host-tool-updates"

type Row = Record<string, unknown>
type TableName = "hosts" | "issues" | "review_runs" | "host_tool_updates"

const NOW = new Date("2026-09-23T12:00:00.000Z")
const ONLINE_HOST = "11111111-1111-4111-8111-111111111111"
const OFFLINE_HOST = "22222222-2222-4222-8222-222222222222"
const BANNED_HOST = "33333333-3333-4333-8333-333333333333"
const OTHER_ACCOUNT_HOST = "44444444-4444-4444-8444-444444444444"

class FakeSupabase {
  hosts: Row[] = []
  issues: Row[] = []
  review_runs: Row[] = []
  host_tool_updates: Row[] = []
  private nextId = 0

  from(table: TableName) {
    return new FakeQuery(table, this)
  }

  generateId() {
    this.nextId += 1
    return `update-${this.nextId}`
  }
}

type QueryResult = {
  data: unknown
  error: { message: string; code?: string } | null
}

class FakeQuery implements PromiseLike<QueryResult> {
  private readonly filters: Array<(row: Row) => boolean> = []
  private op: "select" | "insert" | "update" | "delete" = "select"
  private payload: Row[] = []
  private patch: Row = {}
  private orderBy: { column: string; ascending: boolean } | null = null
  private limitTo: number | null = null
  private single = false

  constructor(
    private readonly table: TableName,
    private readonly db: FakeSupabase
  ) {}

  select() {
    return this
  }

  returns() {
    return this
  }

  order(column: string, options: { ascending: boolean }) {
    this.orderBy = { column, ascending: options.ascending }
    return this
  }

  limit(count: number) {
    this.limitTo = count
    return this
  }

  maybeSingle() {
    this.single = true
    return this
  }

  insert(rows: Row | Row[]) {
    this.op = "insert"
    this.payload = Array.isArray(rows) ? rows : [rows]
    return this
  }

  update(patch: Row) {
    this.op = "update"
    this.patch = patch
    return this
  }

  delete() {
    this.op = "delete"
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

  gt(column: string, value: string) {
    this.filters.push((row) => String(row[column]) > value)
    return this
  }

  lte(column: string, value: string) {
    this.filters.push((row) => String(row[column]) <= value)
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

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.execute().then(onfulfilled, onrejected)
  }

  private rows() {
    return this.db[this.table]
  }

  private matches(row: Row) {
    return this.filters.every((filter) => filter(row))
  }

  private async execute(): Promise<QueryResult> {
    if (this.op === "insert") {
      const inserted: Row[] = []
      for (const row of this.payload) {
        const complete = { id: this.db.generateId(), ...row }
        const violation = this.uniqueViolation(complete)
        if (violation) {
          return { data: null, error: { code: "23505", message: violation } }
        }
        this.rows().push(complete)
        inserted.push(complete)
      }
      return { data: inserted.map((row) => ({ ...row })), error: null }
    }

    if (this.op === "update") {
      const updated: Row[] = []
      for (const row of this.rows()) {
        if (!this.matches(row)) continue
        const next = { ...row, ...this.patch }
        const violation = this.uniqueViolation(next, row)
        if (violation) {
          return { data: null, error: { code: "23505", message: violation } }
        }
        Object.assign(row, this.patch)
        updated.push({ ...row })
      }
      return { data: updated, error: null }
    }

    if (this.op === "delete") {
      this.db[this.table] = this.rows().filter((row) => !this.matches(row))
      return { data: null, error: null }
    }

    let rows = this.rows().filter((row) => this.matches(row))
    if (this.orderBy) {
      const { column, ascending } = this.orderBy
      rows = [...rows].sort((left, right) => {
        const order = String(left[column]).localeCompare(String(right[column]))
        return ascending ? order : -order
      })
    }
    if (this.limitTo !== null) {
      rows = rows.slice(0, this.limitTo)
    }
    if (this.single) {
      return { data: rows[0] ? { ...rows[0] } : null, error: null }
    }
    return { data: rows.map((row) => ({ ...row })), error: null }
  }

  private uniqueViolation(row: Row, except?: Row): string | null {
    if (this.table !== "host_tool_updates") return null
    const others = this.rows().filter((existing) => existing !== except)

    if (
      ["waiting", "updating"].includes(String(row.status)) &&
      others.some(
        (existing) =>
          existing.host_id === row.host_id &&
          existing.tool === row.tool &&
          ["waiting", "updating"].includes(String(existing.status))
      )
    ) {
      return 'duplicate key value violates unique constraint "host_tool_updates_one_pending_per_tool_idx"'
    }

    if (
      row.status === "updating" &&
      others.some(
        (existing) =>
          existing.host_id === row.host_id && existing.status === "updating"
      )
    ) {
      return 'duplicate key value violates unique constraint "host_tool_updates_one_updating_per_host_idx"'
    }

    return null
  }
}

function seededDb(): FakeSupabase {
  const db = new FakeSupabase()
  db.hosts = [
    hostRow({ id: ONLINE_HOST, display_name: "online" }),
    hostRow({
      id: OFFLINE_HOST,
      display_name: "offline",
      last_seen_at: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
    }),
    hostRow({
      id: BANNED_HOST,
      display_name: "banned",
      banned_at: NOW.toISOString(),
    }),
    hostRow({
      id: OTHER_ACCOUNT_HOST,
      display_name: "someone else",
      user_id: "user-2",
    }),
  ]
  return db
}

function hostRow(overrides: Row = {}): Row {
  return {
    id: ONLINE_HOST,
    user_id: "user-1",
    display_name: "host",
    setup_state: "ready",
    banned_at: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    last_seen_at: NOW.toISOString(),
    process_started_at: NOW.toISOString(),
    gentic_version: "9.9.9",
    os: "linux",
    arch: "x64",
    configured_capacity: 1,
    provider_capabilities: { providers: {} },
    ...overrides,
  }
}

function supabase(db: FakeSupabase) {
  return db as never
}

test("eligibility mirrors the host's primary state", () => {
  assert.equal(
    hostToolUpdateIneligibilityReason({ primary_state: "online" }),
    null
  )
  assert.equal(
    hostToolUpdateIneligibilityReason({ primary_state: "offline" }),
    "offline"
  )
  assert.equal(
    hostToolUpdateIneligibilityReason({ primary_state: "banned" }),
    "banned"
  )
  assert.equal(
    hostToolUpdateIneligibilityReason({ primary_state: "setup-incomplete" }),
    "setup-incomplete"
  )
})

test("queues a waiting command for an online host owned by the caller", async () => {
  const db = seededDb()

  const update = await createHostToolUpdate(
    supabase(db),
    "user-1",
    ONLINE_HOST,
    { tool: "codex" },
    { now: NOW }
  )

  assert.equal(update.tool, "codex")
  assert.equal(update.status, "waiting")
  assert.equal(update.host_id, ONLINE_HOST)
  assert.equal(
    update.expires_at,
    new Date(NOW.getTime() + HOST_TOOL_UPDATE_TTL_MS).toISOString()
  )
  assert.equal(db.host_tool_updates[0].user_id, "user-1")
})

test("several tools may be queued for one host but the same tool only once", async () => {
  const db = seededDb()

  await createHostToolUpdate(
    supabase(db),
    "user-1",
    ONLINE_HOST,
    { tool: "gentic" },
    { now: NOW }
  )
  await createHostToolUpdate(
    supabase(db),
    "user-1",
    ONLINE_HOST,
    { tool: "github" },
    { now: NOW }
  )

  await assert.rejects(
    createHostToolUpdate(
      supabase(db),
      "user-1",
      ONLINE_HOST,
      { tool: "github" },
      { now: NOW }
    ),
    (error: unknown) =>
      error instanceof ServiceError &&
      error.code === "conflict" &&
      /GitHub CLI is already being updated/.test(error.message)
  )
  assert.equal(db.host_tool_updates.length, 2)
})

test("refuses offline, banned and foreign hosts and unknown tools", async () => {
  const db = seededDb()

  await assert.rejects(
    createHostToolUpdate(
      supabase(db),
      "user-1",
      OFFLINE_HOST,
      {
        tool: "gentic",
      },
      { now: NOW }
    ),
    (error: unknown) =>
      error instanceof ServiceError &&
      error.code === "conflict" &&
      /offline/.test(error.message)
  )
  await assert.rejects(
    createHostToolUpdate(
      supabase(db),
      "user-1",
      BANNED_HOST,
      {
        tool: "gentic",
      },
      { now: NOW }
    ),
    (error: unknown) =>
      error instanceof ServiceError && /banned/.test(error.message)
  )
  await assert.rejects(
    createHostToolUpdate(
      supabase(db),
      "user-1",
      OTHER_ACCOUNT_HOST,
      {
        tool: "gentic",
      },
      { now: NOW }
    ),
    (error: unknown) =>
      error instanceof ServiceError && error.code === "not_found"
  )
  await assert.rejects(
    createHostToolUpdate(
      supabase(db),
      "user-1",
      ONLINE_HOST,
      {
        tool: "helm",
      } as never,
      { now: NOW }
    ),
    (error: unknown) =>
      error instanceof ServiceError && error.code === "validation"
  )
  assert.equal(db.host_tool_updates.length, 0)
})

test("a host claims its oldest waiting command exactly once, one at a time", async () => {
  const db = seededDb()
  await createHostToolUpdate(
    supabase(db),
    "user-1",
    ONLINE_HOST,
    { tool: "github" },
    { now: NOW }
  )
  await createHostToolUpdate(
    supabase(db),
    "user-1",
    ONLINE_HOST,
    { tool: "codex" },
    { now: new Date(NOW.getTime() + 1_000) }
  )

  const first = await claimHostToolUpdate(supabase(db), ONLINE_HOST, {
    now: NOW,
  })
  assert.equal(first?.tool, "github")
  assert.equal(db.host_tool_updates[0].status, "updating")
  assert.equal(db.host_tool_updates[0].accepted_at, NOW.toISOString())

  // While github is updating, codex stays queued: one update per host.
  assert.equal(
    await claimHostToolUpdate(supabase(db), ONLINE_HOST, { now: NOW }),
    null
  )

  await reportHostToolUpdateResult(
    supabase(db),
    ONLINE_HOST,
    first!.id,
    { status: "updated", summary: "Updated to 2.60.0", version: "2.60.0" },
    { now: NOW }
  )

  const second = await claimHostToolUpdate(supabase(db), ONLINE_HOST, {
    now: NOW,
  })
  assert.equal(second?.tool, "codex")
  assert.equal(
    await claimHostToolUpdate(supabase(db), ONLINE_HOST, { now: NOW }),
    null
  )
  // Another host never sees this host's commands.
  assert.equal(
    await claimHostToolUpdate(supabase(db), OFFLINE_HOST, { now: NOW }),
    null
  )
})

test("a report is accepted once, for the claiming host, and is scrubbed", async () => {
  const db = seededDb()
  const created = await createHostToolUpdate(
    supabase(db),
    "user-1",
    ONLINE_HOST,
    { tool: "gentic" },
    { now: NOW }
  )

  await assert.rejects(
    reportHostToolUpdateResult(supabase(db), ONLINE_HOST, created.id, {
      status: "failed",
    }),
    (error: unknown) =>
      error instanceof ServiceError && error.code === "not_found"
  )

  await claimHostToolUpdate(supabase(db), ONLINE_HOST, { now: NOW })

  await assert.rejects(
    reportHostToolUpdateResult(supabase(db), OFFLINE_HOST, created.id, {
      status: "failed",
    }),
    (error: unknown) =>
      error instanceof ServiceError && error.code === "not_found"
  )

  const reported = await reportHostToolUpdateResult(
    supabase(db),
    ONLINE_HOST,
    created.id,
    {
      status: "failed",
      summary: "npm install -g gentic-cli@latest exited with code 1.",
      output:
        "npm error EACCES /home/ada/.npm\n//registry.npmjs.org/:_authToken=npm_abcdefghijklmnopqrstu",
    },
    { now: NOW }
  )

  assert.equal(reported.status, "failed")
  assert.equal(
    reported.output,
    "npm error EACCES ~/.npm\n//registry.npmjs.org/:_authToken=[redacted]"
  )
  assert.equal(reported.version, null)

  await assert.rejects(
    reportHostToolUpdateResult(supabase(db), ONLINE_HOST, created.id, {
      status: "updated",
    }),
    (error: unknown) =>
      error instanceof ServiceError && error.code === "not_found"
  )
})

test("listing is scoped to the owner and the host, oldest first", async () => {
  const db = seededDb()
  await createHostToolUpdate(
    supabase(db),
    "user-1",
    ONLINE_HOST,
    { tool: "codex" },
    { now: new Date(NOW.getTime() + 1_000) }
  )
  await createHostToolUpdate(
    supabase(db),
    "user-1",
    ONLINE_HOST,
    { tool: "gentic" },
    { now: NOW }
  )

  const updates = await listHostToolUpdates(
    supabase(db),
    "user-1",
    ONLINE_HOST,
    { now: NOW }
  )
  assert.deepEqual(
    updates.map((update) => update.tool),
    ["gentic", "codex"]
  )
  assert.deepEqual(
    await listHostToolUpdates(supabase(db), "user-2", ONLINE_HOST, {
      now: NOW,
    }),
    []
  )
  assert.deepEqual(
    await listHostToolUpdates(supabase(db), "user-1", OFFLINE_HOST, {
      now: NOW,
    }),
    []
  )
})

test("unclaimed and unfinished commands time out, and old rows are purged", async () => {
  const db = seededDb()
  const created = await createHostToolUpdate(
    supabase(db),
    "user-1",
    ONLINE_HOST,
    { tool: "claude_code" },
    { now: NOW }
  )
  const afterExpiry = new Date(NOW.getTime() + HOST_TOOL_UPDATE_TTL_MS + 1)

  assert.equal(
    await claimHostToolUpdate(supabase(db), ONLINE_HOST, { now: afterExpiry }),
    null
  )
  const [update] = await listHostToolUpdates(
    supabase(db),
    "user-1",
    ONLINE_HOST,
    { now: afterExpiry }
  )
  assert.equal(update.id, created.id)
  assert.equal(update.status, "timed-out")

  await expireHostToolUpdates(supabase(db), {
    now: new Date(NOW.getTime() + HOST_TOOL_UPDATE_RETENTION_MS),
  })
  assert.equal(db.host_tool_updates.length, 0)
})
