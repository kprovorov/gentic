import assert from "node:assert/strict"
import { test } from "node:test"

import {
  attachIssuePullRequest,
  bulkUpdateIssueStatus,
  updateIssueStatus,
  updateIssueStatusByPrUrl,
  updateIssueStatusByPrUrlIfStatus,
} from "./workflow"

type IssueRecord = { id: string; status: string }

class FakeIssuesQuery {
  private selectedIds: string[] = []
  private updateValues: Record<string, unknown> | null = null

  constructor(private readonly db: FakeSupabase) {}

  select() {
    return this
  }

  update(values: Record<string, unknown>) {
    this.updateValues = values
    return this
  }

  in(_column: string, ids: string[]) {
    this.selectedIds = ids

    if (this.updateValues) {
      this.db.updates.push({ ids, values: this.updateValues })
      return Promise.resolve({ data: null, error: null })
    }

    return this
  }

  eq() {
    return Promise.resolve({
      data: this.db.issues.filter((issue) =>
        this.selectedIds.includes(issue.id)
      ),
      error: null,
    })
  }
}

class FakeSupabase {
  readonly rpcs: Array<{ name: string; args: Record<string, unknown> }> = []
  readonly updates: Array<{ ids: string[]; values: Record<string, unknown> }> =
    []

  constructor(readonly issues: IssueRecord[]) {}

  from(table: string) {
    assert.equal(table, "issues")
    return new FakeIssuesQuery(this)
  }

  rpc(name: string, args: Record<string, unknown>) {
    this.rpcs.push({ name, args })
    return Promise.resolve({ data: null, error: null })
  }
}

test("bulkUpdateIssueStatus starts selected drafts when moving them to todo", async () => {
  const supabase = new FakeSupabase([
    { id: "draft-1", status: "draft" },
    { id: "waiting-1", status: "waiting-for-input" },
    { id: "draft-2", status: "draft" },
  ])

  await bulkUpdateIssueStatus(
    supabase as never,
    "user-1",
    ["draft-1", "waiting-1", "draft-2", "draft-1"],
    "todo"
  )

  assert.deepEqual(
    supabase.rpcs.map((rpc) => rpc.args.p_issue_id),
    ["draft-1", "draft-2"]
  )
  assert.deepEqual(supabase.updates, [
    {
      ids: ["waiting-1"],
      values: {
        status: "todo",
        updated_at: supabase.updates[0]?.values.updated_at,
      },
    },
  ])
  assert.equal(typeof supabase.updates[0]?.values.updated_at, "string")
})

test("bulkUpdateIssueStatus directly updates all issues for non-start statuses", async () => {
  const supabase = new FakeSupabase([
    { id: "draft-1", status: "draft" },
    { id: "todo-1", status: "todo" },
  ])

  await bulkUpdateIssueStatus(
    supabase as never,
    "user-1",
    ["draft-1", "todo-1"],
    "cancelled"
  )

  assert.deepEqual(supabase.rpcs, [])
  assert.deepEqual(supabase.updates[0]?.ids, ["draft-1", "todo-1"])
  assert.equal(supabase.updates[0]?.values.status, "cancelled")
})

// A generic, table-driven fake covering the small set of query-builder chains
// the event-logging functions below actually use (select/update/insert/
// upsert + eq/maybeSingle), so each function can be exercised against real
// in-memory `issues` / `issue_pull_requests` / `issue_events` rows rather
// than a bespoke mock per test.
type Row = Record<string, unknown>
type TableName = "issues" | "issue_pull_requests" | "issue_events"

class EventLogDb {
  issues: Row[] = []
  issue_pull_requests: Row[] = []
  issue_events: Row[] = []
}

class EventLogQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Array<[string, unknown]> = []
  private op: "select" | "update" | "insert" | "upsert" = "select"
  private payload: Row | null = null
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {}
  private wantsSingle = false
  private wantsSelectAfterWrite = false

  constructor(
    private readonly table: TableName,
    private readonly db: EventLogDb
  ) {}

  select() {
    if (this.op === "update" || this.op === "upsert") {
      this.wantsSelectAfterWrite = true
    }
    return this
  }

  eq(col: string, val: unknown) {
    this.filters.push([col, val])
    return this
  }

  update(values: Row) {
    this.op = "update"
    this.payload = values
    return this
  }

  insert(values: Row) {
    this.op = "insert"
    this.payload = values
    return this
  }

  upsert(
    values: Row,
    opts: { onConflict?: string; ignoreDuplicates?: boolean }
  ) {
    this.op = "upsert"
    this.payload = values
    this.upsertOpts = opts
    return this
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
    return this.execute().then(onfulfilled, onrejected)
  }

  private matches(row: Row): boolean {
    return this.filters.every(([col, val]) => {
      let value: unknown = row
      for (const part of col.split(".")) {
        value = (value as Row | undefined)?.[part]
      }
      return value === val
    })
  }

  private rows(): Row[] {
    return this.db[this.table]
  }

  private async execute(): Promise<{ data: unknown; error: null }> {
    if (this.op === "select") {
      // Return shallow copies, not the live rows, so a later `.update()`
      // mutating the row in place can't retroactively change a value already
      // read out by an earlier `.select()` (e.g. the "from" status captured
      // before an update).
      const matched = this.rows()
        .filter((row) => this.matches(row))
        .map((row) => ({ ...row }))
      return {
        data: this.wantsSingle ? (matched[0] ?? null) : matched,
        error: null,
      }
    }

    if (this.op === "update") {
      const matched = this.rows().filter((row) => this.matches(row))
      matched.forEach((row) => Object.assign(row, this.payload))
      if (!this.wantsSelectAfterWrite) {
        return { data: null, error: null }
      }
      return {
        data: this.wantsSingle ? (matched[0] ?? null) : matched,
        error: null,
      }
    }

    if (this.op === "insert") {
      const row: Row = {
        id: `${this.table}-${this.rows().length + 1}`,
        created_at: new Date().toISOString(),
        ...this.payload,
      }
      this.rows().push(row)
      return { data: null, error: null }
    }

    // upsert
    const conflictCol = this.upsertOpts.onConflict ?? "id"
    const existing = this.rows().find(
      (row) => row[conflictCol] === this.payload?.[conflictCol]
    )
    if (existing) {
      if (this.upsertOpts.ignoreDuplicates) {
        return { data: this.wantsSelectAfterWrite ? [] : null, error: null }
      }
      Object.assign(existing, this.payload)
      return {
        data: this.wantsSelectAfterWrite ? [existing] : null,
        error: null,
      }
    }
    const row: Row = {
      id: `${this.table}-${this.rows().length + 1}`,
      created_at: new Date().toISOString(),
      ...this.payload,
    }
    this.rows().push(row)
    return { data: this.wantsSelectAfterWrite ? [row] : null, error: null }
  }
}

class EventLogSupabase {
  constructor(readonly db: EventLogDb) {}

  from(table: TableName) {
    return new EventLogQuery(table, this.db)
  }
}

function issueRow(overrides: Row): Row {
  return {
    prompt: null,
    projects: { user_id: "user-1" },
    ...overrides,
  }
}

test("updateIssueStatus logs a status_changed event with from/to", async () => {
  const db = new EventLogDb()
  db.issues.push(issueRow({ id: "issue-1", status: "todo" }))
  const supabase = new EventLogSupabase(db)

  await updateIssueStatus(supabase as never, "user-1", "issue-1", "in-progress")

  assert.deepEqual(
    db.issue_events.map((event) => ({
      issue_id: event.issue_id,
      type: event.type,
      payload: event.payload,
    })),
    [
      {
        issue_id: "issue-1",
        type: "status_changed",
        payload: { from: "todo", to: "in-progress" },
      },
    ]
  )
})

test("updateIssueStatusByPrUrl logs a status_changed event when found via issue_pull_requests", async () => {
  const db = new EventLogDb()
  db.issues.push(issueRow({ id: "issue-2", status: "in-progress" }))
  db.issue_pull_requests.push({
    id: "pr-1",
    issue_id: "issue-2",
    url: "https://github.com/acme/widget/pull/1",
  })
  const supabase = new EventLogSupabase(db)

  await updateIssueStatusByPrUrl(
    supabase as never,
    "https://github.com/acme/widget/pull/1",
    "ready-for-review"
  )

  assert.deepEqual(
    db.issue_events.map((event) => ({
      issue_id: event.issue_id,
      type: event.type,
      payload: event.payload,
    })),
    [
      {
        issue_id: "issue-2",
        type: "status_changed",
        payload: { from: "in-progress", to: "ready-for-review" },
      },
    ]
  )
})

test("updateIssueStatusByPrUrl logs via the legacy issues.pr_url fallback", async () => {
  const db = new EventLogDb()
  db.issues.push(
    issueRow({
      id: "issue-3",
      status: "in-progress",
      pr_url: "https://github.com/acme/widget/pull/2",
    })
  )
  const supabase = new EventLogSupabase(db)

  await updateIssueStatusByPrUrl(
    supabase as never,
    "https://github.com/acme/widget/pull/2",
    "merged"
  )

  assert.deepEqual(
    db.issue_events.map((event) => event.payload),
    [{ from: "in-progress", to: "merged" }]
  )
})

test("updateIssueStatusByPrUrl logs nothing when no issue matches the PR url", async () => {
  const db = new EventLogDb()
  db.issues.push(issueRow({ id: "issue-4", status: "in-progress" }))
  const supabase = new EventLogSupabase(db)

  const result = await updateIssueStatusByPrUrl(
    supabase as never,
    "https://github.com/acme/widget/pull/does-not-exist",
    "merged"
  )

  assert.equal(result, null)
  assert.deepEqual(db.issue_events, [])
})

test("updateIssueStatusByPrUrlIfStatus logs a status_changed event when the guard matches", async () => {
  const db = new EventLogDb()
  db.issues.push(
    issueRow({
      id: "issue-5",
      status: "testing",
      pr_url: "https://github.com/acme/widget/pull/5",
    })
  )
  const supabase = new EventLogSupabase(db)

  await updateIssueStatusByPrUrlIfStatus(
    supabase as never,
    "https://github.com/acme/widget/pull/5",
    "testing",
    "ready-for-review"
  )

  assert.deepEqual(
    db.issue_events.map((event) => event.payload),
    [{ from: "testing", to: "ready-for-review" }]
  )
})

test("updateIssueStatusByPrUrlIfStatus moves ready for review issues back to testing", async () => {
  const db = new EventLogDb()
  db.issues.push(
    issueRow({
      id: "issue-8",
      status: "ready-for-review",
      pr_url: "https://github.com/acme/widget/pull/8",
    })
  )
  const supabase = new EventLogSupabase(db)

  await updateIssueStatusByPrUrlIfStatus(
    supabase as never,
    "https://github.com/acme/widget/pull/8",
    "ready-for-review",
    "testing"
  )

  assert.deepEqual(
    db.issue_events.map((event) => event.payload),
    [{ from: "ready-for-review", to: "testing" }]
  )
})

test("updateIssueStatusByPrUrlIfStatus logs nothing when the issue has moved past fromStatus", async () => {
  const db = new EventLogDb()
  db.issues.push(
    issueRow({
      id: "issue-6",
      status: "changes-requested",
      pr_url: "https://github.com/acme/widget/pull/6",
    })
  )
  const supabase = new EventLogSupabase(db)

  await updateIssueStatusByPrUrlIfStatus(
    supabase as never,
    "https://github.com/acme/widget/pull/6",
    "testing",
    "ready-for-review"
  )

  assert.deepEqual(db.issue_events, [])
})

test("attachIssuePullRequest logs pr_opened once, not again on a duplicate call", async () => {
  const db = new EventLogDb()
  const supabase = new EventLogSupabase(db)

  await attachIssuePullRequest(
    supabase as never,
    "issue-7",
    "https://github.com/acme/widget/pull/7"
  )
  await attachIssuePullRequest(
    supabase as never,
    "issue-7",
    "https://github.com/acme/widget/pull/7"
  )

  assert.deepEqual(
    db.issue_events.map((event) => ({
      issue_id: event.issue_id,
      type: event.type,
      payload: event.payload,
    })),
    [
      {
        issue_id: "issue-7",
        type: "pr_opened",
        payload: { pr_url: "https://github.com/acme/widget/pull/7" },
      },
    ]
  )
})

test("a raw run-state style status update does not log an event", async () => {
  const db = new EventLogDb()
  db.issues.push(issueRow({ id: "issue-8", status: "queued" }))
  const supabase = new EventLogSupabase(db)

  // Mirrors the plain `.update()` call in the run-state route, which
  // deliberately bypasses `updateIssueStatus` to avoid logging every noisy
  // agent-run-state transition as a timeline milestone.
  await supabase
    .from("issues")
    .update({ status: "in-progress" })
    .eq("id", "issue-8")

  assert.deepEqual(db.issue_events, [])
})
