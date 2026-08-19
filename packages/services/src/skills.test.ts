import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "./errors"
import {
  claimWorkerSkillInstall,
  createWorkerSkillInstalls,
  evaluateSkillAudits,
  expireWorkerSkillInstalls,
  fetchSkillAudits,
  listSkillInstallTargets,
  listWorkerSkillInstalls,
  reportWorkerSkillInstallResult,
  SkillAuditGateError,
  SKILL_INSTALL_RETENTION_MS,
} from "./skills"

type Row = Record<string, unknown>
type TableName = "workers" | "issues" | "review_runs" | "worker_skill_installs"

const NOW = new Date("2026-08-12T12:00:00.000Z")
const SKILL_URL = "https://skills.sh/anthropics/skills/pdf"
const ONLINE_WORKER = "11111111-1111-4111-8111-111111111111"
const OFFLINE_WORKER = "22222222-2222-4222-8222-222222222222"
const BANNED_WORKER = "33333333-3333-4333-8333-333333333333"
const OTHER_ACCOUNT_WORKER = "44444444-4444-4444-8444-444444444444"

class FakeSupabase {
  workers: Row[] = []
  issues: Row[] = []
  review_runs: Row[] = []
  worker_skill_installs: Row[] = []
  private nextId = 0

  from(table: TableName) {
    return new FakeQuery(table, this)
  }

  generateId() {
    this.nextId += 1
    return `install-${this.nextId}`
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
        if (this.violatesActiveInstallUnique(complete)) {
          return {
            data: null,
            error: {
              code: "23505",
              message:
                'duplicate key value violates unique constraint "worker_skill_installs_one_active_per_worker_idx"',
            },
          }
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
        Object.assign(row, this.patch)
        updated.push({ ...row })
      }
      return { data: updated, error: null }
    }

    if (this.op === "delete") {
      this.db[this.table] = this.rows().filter((row) => !this.matches(row))
      return { data: null, error: null }
    }

    return {
      data: this.rows()
        .filter((row) => this.matches(row))
        .map((row) => ({ ...row })),
      error: null,
    }
  }

  private violatesActiveInstallUnique(row: Row) {
    if (this.table !== "worker_skill_installs") return false
    if (!["waiting", "installing"].includes(String(row.status))) return false

    return this.rows().some(
      (existing) =>
        existing.worker_id === row.worker_id &&
        ["waiting", "installing"].includes(String(existing.status))
    )
  }
}

function seededDb(): FakeSupabase {
  const db = new FakeSupabase()
  db.workers = [
    workerRow({ id: ONLINE_WORKER, display_name: "online" }),
    workerRow({
      id: OFFLINE_WORKER,
      display_name: "offline",
      last_seen_at: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
    }),
    workerRow({
      id: BANNED_WORKER,
      display_name: "banned",
      banned_at: NOW.toISOString(),
    }),
    workerRow({
      id: OTHER_ACCOUNT_WORKER,
      display_name: "someone else",
      user_id: "user-2",
    }),
  ]
  return db
}

function workerRow(overrides: Row = {}): Row {
  return {
    id: ONLINE_WORKER,
    user_id: "user-1",
    display_name: "worker",
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

function auditFetch(
  audits: unknown,
  init: { status?: number } = {}
): typeof globalThis.fetch {
  return (async () =>
    new Response(JSON.stringify(audits), {
      status: init.status ?? 200,
      headers: { "content-type": "application/json" },
    })) as typeof globalThis.fetch
}

const passingAudits = auditFetch({
  id: "anthropics/skills/pdf",
  source: "anthropics/skills",
  slug: "pdf",
  audits: [
    {
      provider: "Socket",
      status: "pass",
      auditedAt: new Date(NOW.getTime() - 24 * 60 * 60_000).toISOString(),
    },
  ],
})

test("audits that all pass and are current need no risk acceptance", () => {
  const gate = evaluateSkillAudits(
    {
      outcome: "audited",
      audits: [
        {
          provider: "Snyk",
          status: "pass",
          auditedAt: new Date(NOW.getTime() - 60_000).toISOString(),
        },
      ],
    },
    { now: NOW }
  )

  assert.deepEqual(gate.decision, "allow")
  assert.deepEqual(gate.reasons, [])
})

test("a failing audit blocks, and warnings, staleness, gaps and outages ask for confirmation", () => {
  const cases: Array<
    [Parameters<typeof evaluateSkillAudits>[0], string, string[]]
  > = [
    [
      {
        outcome: "audited",
        audits: [
          { provider: "Snyk", status: "fail", auditedAt: NOW.toISOString() },
          { provider: "Socket", status: "pass", auditedAt: NOW.toISOString() },
        ],
      },
      "block",
      ["failed"],
    ],
    [
      {
        outcome: "audited",
        audits: [
          { provider: "Socket", status: "warn", auditedAt: NOW.toISOString() },
        ],
      },
      "confirm",
      ["warning"],
    ],
    [
      {
        outcome: "audited",
        audits: [
          {
            provider: "Socket",
            status: "pass",
            auditedAt: new Date(
              NOW.getTime() - 31 * 24 * 60 * 60_000
            ).toISOString(),
          },
        ],
      },
      "confirm",
      ["stale"],
    ],
    [
      { outcome: "audited", audits: [{ provider: "Socket", status: "pass" }] },
      "confirm",
      ["stale"],
    ],
    [{ outcome: "missing" }, "confirm", ["missing"]],
    [{ outcome: "unavailable" }, "confirm", ["unavailable"]],
  ]

  for (const [lookup, decision, reasons] of cases) {
    const gate = evaluateSkillAudits(lookup, { now: NOW })
    assert.equal(gate.decision, decision, JSON.stringify(lookup))
    assert.deepEqual(gate.reasons, reasons, JSON.stringify(lookup))
  }
})

test("audit lookup maps registry responses onto missing and unavailable outcomes", async () => {
  const requested: string[] = []
  const skill = { source: "anthropics/skills", skill: "pdf" }

  assert.deepEqual(
    await fetchSkillAudits(skill, {
      fetchImpl: (async (url: string) => {
        requested.push(url)
        return new Response(
          JSON.stringify({
            id: "anthropics/skills/pdf",
            source: "anthropics/skills",
            slug: "pdf",
            audits: [{ provider: "Socket", status: "pass" }],
          }),
          { status: 200 }
        )
      }) as typeof globalThis.fetch,
    }),
    { outcome: "audited", audits: [{ provider: "Socket", status: "pass" }] }
  )
  assert.deepEqual(requested, [
    "https://www.skills.sh/api/v1/skills/audit/anthropics/skills/pdf",
  ])

  assert.deepEqual(
    await fetchSkillAudits(skill, {
      fetchImpl: auditFetch({ error: "not_found" }, { status: 404 }),
    }),
    { outcome: "missing" }
  )
  assert.deepEqual(
    await fetchSkillAudits(skill, {
      fetchImpl: auditFetch({ error: "boom" }, { status: 503 }),
    }),
    { outcome: "unavailable" }
  )
  assert.deepEqual(
    await fetchSkillAudits(skill, {
      fetchImpl: (() => {
        throw new Error("network down")
      }) as typeof globalThis.fetch,
    }),
    { outcome: "unavailable" }
  )
})

test("dispatch queues one waiting command per selected online worker", async () => {
  const db = seededDb()

  const result = await createWorkerSkillInstalls(
    db as never,
    "user-1",
    { url: SKILL_URL, worker_ids: [ONLINE_WORKER], accept_risk: false },
    { now: NOW, fetchImpl: passingAudits }
  )

  assert.deepEqual(result.skill, {
    source: "anthropics/skills",
    skill: "pdf",
    url: SKILL_URL,
  })
  assert.equal(result.gate.decision, "allow")
  assert.equal(result.installs.length, 1)
  assert.equal(result.installs[0].status, "waiting")
  assert.equal(
    db.worker_skill_installs[0].expires_at,
    new Date(NOW.getTime() + 10 * 60_000).toISOString()
  )
})

test("dispatch refuses workers the account does not own or that are not eligible", async () => {
  for (const workerId of [
    OTHER_ACCOUNT_WORKER,
    OFFLINE_WORKER,
    BANNED_WORKER,
  ]) {
    await assert.rejects(
      createWorkerSkillInstalls(
        seededDb() as never,
        "user-1",
        { url: SKILL_URL, worker_ids: [workerId], accept_risk: false },
        { now: NOW, fetchImpl: passingAudits }
      ),
      (error: unknown) => {
        assert.ok(error instanceof ServiceError)
        assert.ok(["not_found", "conflict"].includes(error.code))
        return true
      },
      workerId
    )
  }
})

test("dispatch refuses a worker that is already installing a skill", async () => {
  const db = seededDb()
  await createWorkerSkillInstalls(
    db as never,
    "user-1",
    { url: SKILL_URL, worker_ids: [ONLINE_WORKER], accept_risk: false },
    { now: NOW, fetchImpl: passingAudits }
  )

  await assert.rejects(
    createWorkerSkillInstalls(
      db as never,
      "user-1",
      { url: SKILL_URL, worker_ids: [ONLINE_WORKER], accept_risk: false },
      { now: NOW, fetchImpl: passingAudits }
    ),
    /already installing/
  )
  assert.equal(db.worker_skill_installs.length, 1)
})

test("dispatch enforces the audit gate server-side", async () => {
  const failing = auditFetch({
    id: "anthropics/skills/pdf",
    source: "anthropics/skills",
    slug: "pdf",
    audits: [
      { provider: "Snyk", status: "fail", auditedAt: NOW.toISOString() },
    ],
  })
  const warning = auditFetch({
    id: "anthropics/skills/pdf",
    source: "anthropics/skills",
    slug: "pdf",
    audits: [
      { provider: "Snyk", status: "warn", auditedAt: NOW.toISOString() },
    ],
  })

  const blocked = seededDb()
  await assert.rejects(
    createWorkerSkillInstalls(
      blocked as never,
      "user-1",
      { url: SKILL_URL, worker_ids: [ONLINE_WORKER], accept_risk: true },
      { now: NOW, fetchImpl: failing }
    ),
    (error: unknown) => {
      assert.ok(error instanceof SkillAuditGateError)
      assert.equal(error.gate.decision, "block")
      return true
    }
  )
  assert.equal(blocked.worker_skill_installs.length, 0)

  const unconfirmed = seededDb()
  await assert.rejects(
    createWorkerSkillInstalls(
      unconfirmed as never,
      "user-1",
      { url: SKILL_URL, worker_ids: [ONLINE_WORKER], accept_risk: false },
      { now: NOW, fetchImpl: warning }
    ),
    (error: unknown) => {
      assert.ok(error instanceof SkillAuditGateError)
      assert.deepEqual(error.gate.reasons, ["warning"])
      return true
    }
  )
  assert.equal(unconfirmed.worker_skill_installs.length, 0)

  const confirmed = seededDb()
  const result = await createWorkerSkillInstalls(
    confirmed as never,
    "user-1",
    { url: SKILL_URL, worker_ids: [ONLINE_WORKER], accept_risk: true },
    { now: NOW, fetchImpl: warning }
  )
  assert.equal(result.installs.length, 1)
})

test("a claimed command is handed to its worker exactly once", async () => {
  const db = seededDb()
  await createWorkerSkillInstalls(
    db as never,
    "user-1",
    { url: SKILL_URL, worker_ids: [ONLINE_WORKER], accept_risk: false },
    { now: NOW, fetchImpl: passingAudits }
  )

  const claimed = await claimWorkerSkillInstall(db as never, ONLINE_WORKER, {
    now: NOW,
  })
  assert.deepEqual(claimed, {
    id: db.worker_skill_installs[0].id as string,
    source: "anthropics/skills",
    skill: "pdf",
    expires_at: db.worker_skill_installs[0].expires_at as string,
  })

  assert.equal(
    await claimWorkerSkillInstall(db as never, ONLINE_WORKER, { now: NOW }),
    null
  )
})

test("another account's worker cannot claim the command", async () => {
  const db = seededDb()
  await createWorkerSkillInstalls(
    db as never,
    "user-1",
    { url: SKILL_URL, worker_ids: [ONLINE_WORKER], accept_risk: false },
    { now: NOW, fetchImpl: passingAudits }
  )

  assert.equal(
    await claimWorkerSkillInstall(db as never, OTHER_ACCOUNT_WORKER, {
      now: NOW,
    }),
    null
  )
  assert.deepEqual(
    await listWorkerSkillInstalls(
      db as never,
      "user-2",
      [db.worker_skill_installs[0].id as string],
      { now: NOW }
    ),
    []
  )
})

test("a worker that reconnects before expiry still receives the command", async () => {
  const db = seededDb()
  await createWorkerSkillInstalls(
    db as never,
    "user-1",
    { url: SKILL_URL, worker_ids: [ONLINE_WORKER], accept_risk: false },
    { now: NOW, fetchImpl: passingAudits }
  )

  const reconnected = new Date(NOW.getTime() + 9 * 60_000)
  assert.ok(
    await claimWorkerSkillInstall(db as never, ONLINE_WORKER, {
      now: reconnected,
    })
  )
})

test("a command nobody claims before expiry times out and is never delivered", async () => {
  const db = seededDb()
  const { installs } = await createWorkerSkillInstalls(
    db as never,
    "user-1",
    { url: SKILL_URL, worker_ids: [ONLINE_WORKER], accept_risk: false },
    { now: NOW, fetchImpl: passingAudits }
  )

  const late = new Date(NOW.getTime() + 11 * 60_000)
  assert.equal(
    await claimWorkerSkillInstall(db as never, ONLINE_WORKER, { now: late }),
    null
  )

  const [install] = await listWorkerSkillInstalls(
    db as never,
    "user-1",
    [installs[0].id],
    { now: late }
  )
  assert.equal(install.status, "timed-out")
})

test("results are recorded once, sanitized, and only for the claiming worker", async () => {
  const db = seededDb()
  const { installs } = await createWorkerSkillInstalls(
    db as never,
    "user-1",
    { url: SKILL_URL, worker_ids: [ONLINE_WORKER], accept_risk: false },
    { now: NOW, fetchImpl: passingAudits }
  )
  await claimWorkerSkillInstall(db as never, ONLINE_WORKER, { now: NOW })

  await assert.rejects(
    reportWorkerSkillInstallResult(
      db as never,
      OTHER_ACCOUNT_WORKER,
      installs[0].id,
      { status: "installed" },
      { now: NOW }
    ),
    /not found/
  )

  const reported = await reportWorkerSkillInstallResult(
    db as never,
    ONLINE_WORKER,
    installs[0].id,
    {
      status: "failed",
      error_summary: "npx exited with code 1",
      output: "npm error path /home/ada/.claude",
    },
    { now: NOW }
  )

  assert.equal(reported.status, "failed")
  assert.equal(reported.output, "npm error path ~/.claude")

  await assert.rejects(
    reportWorkerSkillInstallResult(
      db as never,
      ONLINE_WORKER,
      installs[0].id,
      { status: "installed" },
      { now: NOW }
    ),
    /not found/
  )
})

test("install targets keep ineligible workers visible with their reason", async () => {
  const db = seededDb()
  await createWorkerSkillInstalls(
    db as never,
    "user-1",
    { url: SKILL_URL, worker_ids: [ONLINE_WORKER], accept_risk: false },
    { now: NOW, fetchImpl: passingAudits }
  )
  db.workers.push(
    workerRow({
      id: "55555555-5555-4555-8555-555555555555",
      display_name: "fresh",
      setup_state: "enrolling",
    })
  )

  const targets = await listSkillInstallTargets(db as never, "user-1", {
    now: NOW,
  })

  assert.deepEqual(
    targets
      .map((target) => [target.display_name, target.eligible, target.reason])
      .sort(),
    [
      ["banned", false, "banned"],
      ["fresh", false, "setup-incomplete"],
      ["offline", false, "offline"],
      ["online", false, "installing"],
    ]
  )
  assert.equal(
    targets.some((target) => target.display_name === "someone else"),
    false
  )
})

test("command state is swept once the retention window passes", async () => {
  const db = seededDb()
  await createWorkerSkillInstalls(
    db as never,
    "user-1",
    { url: SKILL_URL, worker_ids: [ONLINE_WORKER], accept_risk: false },
    { now: NOW, fetchImpl: passingAudits }
  )

  await expireWorkerSkillInstalls(db as never, {
    now: new Date(NOW.getTime() + SKILL_INSTALL_RETENTION_MS + 1_000),
  })

  assert.deepEqual(db.worker_skill_installs, [])
})
