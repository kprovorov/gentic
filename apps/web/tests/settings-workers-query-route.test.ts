import assert from "node:assert/strict"
import test from "node:test"

import { createJsonQueryHandler } from "../app/api/app/api-query-route"
import { listSettingsWorkersData } from "../app/settings/workers-read-model"

type Row = Record<string, unknown>
type TableName = "workers" | "issues"

class FakeSupabase {
  workers: Row[] = []
  issues: Row[] = []

  from(table: TableName) {
    return new FakeQuery(table, this)
  }
}

class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  private readonly filters: Array<(row: Row) => boolean> = []
  private op: "select" | "delete" = "select"

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

  order() {
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

  delete() {
    this.op = "delete"
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
  ) {
    return this.execute().then(onfulfilled, onrejected)
  }

  private rows() {
    return this.db[this.table]
  }

  private matches(row: Row) {
    return this.filters.every((filter) => filter(row))
  }

  private async execute() {
    if (this.op === "delete") {
      const kept = this.rows().filter((row) => !this.matches(row))
      this.db[this.table] = kept
      return { data: null, error: null }
    }

    return {
      data: this.rows()
        .filter((row) => this.matches(row))
        .map((row) => ({ ...row })),
      error: null,
    }
  }
}

test("settings workers query scopes rows to the owner and returns the approved shape", async () => {
  const db = seededDb()

  const data = await listSettingsWorkersData(db as never, "user-1")

  assert.deepEqual(
    data.workers.map((worker) => worker.id).sort(),
    ["banned", "offline", "online", "setup"]
  )
  assert.deepEqual(data.summary, { online: 1, offline: 1, banned: 1 })

  const online = data.workers.find((worker) => worker.id === "online")
  assert.ok(online)
  assert.deepEqual(Object.keys(online).sort(), [
    "architecture",
    "configuredCapacity",
    "connectedAt",
    "editableName",
    "genticVersion",
    "genticVersionHealth",
    "id",
    "lastSeenAt",
    "os",
    "primaryState",
    "processStartedAt",
    "providers",
    "runningCount",
    "setupCompleted",
  ])
  assert.equal(online.primaryState, "online")
  assert.equal(online.runningCount, 2)
  assert.equal(online.configuredCapacity, 4)
  assert.equal(online.setupCompleted, true)
  assert.deepEqual(online.providers, {
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

  const serialized = JSON.stringify(data)
  for (const forbidden of [
    "Task title",
    "issue-1",
    "https://github.com/acme/repo/issues/1",
    "raw log",
    "192.0.2.1",
    "alice",
    "/Users/alice",
    "heartbeat_history",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden)
  }
})

test("settings workers query derives offline state using the 90 second threshold", async () => {
  const db = seededDb()
  const data = await listSettingsWorkersData(db as never, "user-1")

  const stateById = new Map(
    data.workers.map((worker) => [worker.id, worker.primaryState])
  )
  assert.equal(stateById.get("online"), "online")
  assert.equal(stateById.get("offline"), "offline")
  assert.equal(stateById.get("banned"), "banned")
  assert.equal(stateById.get("setup"), "setup-incomplete")
})

test("settings workers route returns scoped query data", async () => {
  const db = seededDb()
  const route = createJsonQueryHandler(
    ({ context }: { context: { supabase: never; userId: string } }) =>
      listSettingsWorkersData(context.supabase, context.userId),
    {
      getContext: async () =>
        ({
          supabase: db as never,
          userId: "user-1",
        }) as never,
      isNotFoundError: () => false,
    }
  )

  const response = await route(
    new Request("http://localhost/api/app/settings/workers")
  )

  assert.equal(response.status, 200)
  const body = await response.json()
  assert.deepEqual(body.summary, { online: 1, offline: 1, banned: 1 })
  assert.equal(
    body.workers.some((worker: { id: string }) => worker.id === "theirs"),
    false
  )
})

test("settings workers query no longer returns a deleted worker", async () => {
  const db = seededDb()
  await db.from("workers").delete().eq("id", "offline")

  const data = await listSettingsWorkersData(db as never, "user-1")

  assert.equal(
    data.workers.some((worker) => worker.id === "offline"),
    false
  )
  assert.deepEqual(data.summary, { online: 1, offline: 0, banned: 1 })
})

function seededDb() {
  const db = new FakeSupabase()
  const now = Date.now()
  const recent = new Date(now - 30_000).toISOString()
  const stale = new Date(now - 91_000).toISOString()
  const createdAt = new Date(now - 3_600_000).toISOString()

  db.workers.push(
    workerRow({
      id: "online",
      display_name: "Online worker",
      configured_capacity: 4,
      last_seen_at: recent,
      created_at: createdAt,
      process_started_at: createdAt,
      provider_capabilities: {
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
      },
    }),
    workerRow({
      id: "offline",
      display_name: "Offline worker",
      last_seen_at: stale,
    }),
    workerRow({
      id: "banned",
      display_name: "Banned worker",
      banned_at: recent,
      last_seen_at: recent,
    }),
    workerRow({
      id: "setup",
      display_name: "Setup worker",
      setup_state: "enrolling",
      last_seen_at: recent,
    }),
    workerRow({
      id: "theirs",
      user_id: "user-2",
      display_name: "Their worker",
      last_seen_at: recent,
    })
  )

  db.issues.push(
    issueRow({
      id: "issue-1",
      active_worker_id: "online",
      active_run_id: "run-1",
      title: "Task title",
      url: "https://github.com/acme/repo/issues/1",
      raw_log: "raw log",
    }),
    issueRow({
      id: "issue-2",
      active_worker_id: "online",
      active_run_id: "run-2",
    }),
    issueRow({ id: "issue-3", active_worker_id: "online", status: "completed" }),
    issueRow({ id: "issue-orphan", active_worker_id: "online", status: "todo" }),
    issueRow({ id: "issue-4", active_worker_id: "theirs" })
  )

  return db
}

function workerRow(overrides: Row = {}): Row {
  return {
    id: "worker",
    user_id: "user-1",
    display_name: "Worker",
    setup_state: "ready",
    banned_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    process_started_at: new Date().toISOString(),
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
    id: "issue",
    active_worker_id: null,
    active_run_id: null,
    status: "in-progress",
    ...overrides,
  }
}
