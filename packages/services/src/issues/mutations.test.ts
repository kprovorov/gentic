import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "../errors"
import { createIssue } from "./mutations"

type Row = Record<string, unknown>
type TableName =
  | "projects"
  | "labels"
  | "issues"
  | "issue_labels"
  | "issue_events"

// A minimal fake covering exactly the query shapes `createIssue` uses
// (ownership checks, label validation, issue insert, issue_labels insert,
// and the compensating delete on assignment failure) — kept separate from
// `workflow.test.ts`'s `EventLogDb` since that fake has no `labels`/
// `issue_labels` tables or `delete()` support.
class FakeDb {
  projects: Row[] = []
  labels: Row[] = []
  issues: Row[] = []
  issue_labels: Row[] = []
  issue_events: Row[] = []
  // Test-only seam simulating a DB trigger rejecting the assignment insert
  // even though the app-level `ensureLabelsAssignable` check passed earlier
  // (e.g. a concurrent archive/delete, or the 20-per-issue cap).
  forceIssueLabelInsertError = false
}

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private readonly filters: Array<(row: Row) => boolean> = []
  private op: "select" | "insert" | "delete" = "select"
  private payload: Row | Row[] | null = null
  private singleMode: "single" | "maybeSingle" | null = null

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

  insert(payload: Row | Row[]) {
    this.op = "insert"
    this.payload = payload
    return this
  }

  delete() {
    this.op = "delete"
    return this
  }

  single() {
    this.singleMode = "single"
    return this
  }

  maybeSingle() {
    this.singleMode = "maybeSingle"
    return this
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?:
      | ((value: {
          data: unknown
          error: unknown
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.execute().then(onfulfilled, onrejected)
  }

  private rows(): Row[] {
    return this.db[this.table]
  }

  private setRows(rows: Row[]) {
    this.db[this.table] = rows
  }

  private matches(row: Row) {
    return this.filters.every((filter) => filter(row))
  }

  private async execute(): Promise<{ data: unknown; error: unknown }> {
    if (this.op === "insert") {
      if (this.table === "issue_labels" && this.db.forceIssueLabelInsertError) {
        return {
          data: null,
          error: { message: "issue label assignment limit reached" },
        }
      }

      const values = Array.isArray(this.payload)
        ? this.payload
        : [this.payload as Row]
      const inserted = values.map((value) => {
        const row: Row = { id: `${this.table}-${this.rows().length + 1}`, ...value }
        this.rows().push(row)
        return row
      })
      return { data: this.singleMode ? inserted[0] : inserted, error: null }
    }

    if (this.op === "delete") {
      this.setRows(this.rows().filter((row) => !this.matches(row)))
      return { data: null, error: null }
    }

    const matched = this.rows().filter((row) => this.matches(row))
    if (this.singleMode === "single") {
      return matched[0]
        ? { data: matched[0], error: null }
        : { data: null, error: { message: "not found" } }
    }
    if (this.singleMode === "maybeSingle") {
      return { data: matched[0] ?? null, error: null }
    }
    return { data: matched, error: null }
  }
}

class FakeSupabase {
  constructor(readonly db: FakeDb) {}

  from(table: TableName) {
    return new FakeQuery(table, this.db)
  }

  rpc(name: string) {
    if (name === "next_issue_number_for_project") {
      return Promise.resolve({ data: this.db.issues.length + 1, error: null })
    }
    return Promise.resolve({ data: null, error: null })
  }
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    project_id: "project-1",
    status: "draft" as const,
    priority: "medium" as const,
    create_pr_automatically: false,
    agent_provider: "claude_code" as const,
    issue_model: null,
    type: "feature" as const,
    label_ids: [] as string[],
    ...overrides,
  }
}

test("createIssue assigns valid label ids and logs no issue event", async () => {
  const db = new FakeDb()
  db.projects.push({ id: "project-1", user_id: "user-1" })
  db.labels.push(
    { id: "label-1", user_id: "user-1", state: "active" },
    { id: "label-2", user_id: "user-1", state: "active" }
  )
  const supabase = new FakeSupabase(db)

  const issue = (await createIssue(
    supabase as never,
    "user-1",
    baseInput({ label_ids: ["label-1", "label-2"] }) as never
  )) as unknown as Row

  assert.deepEqual(
    db.issue_labels
      .filter((row) => row.issue_id === issue.id)
      .map((row) => row.label_id)
      .sort(),
    ["label-1", "label-2"]
  )
  assert.equal(db.issue_events.length, 0)
})

test("createIssue with no label ids never touches issue_labels", async () => {
  const db = new FakeDb()
  db.projects.push({ id: "project-1", user_id: "user-1" })
  const supabase = new FakeSupabase(db)

  await createIssue(supabase as never, "user-1", baseInput() as never)

  assert.equal(db.issue_labels.length, 0)
})

test("createIssue rejects a label owned by another account and creates no issue", async () => {
  const db = new FakeDb()
  db.projects.push({ id: "project-1", user_id: "user-1" })
  db.labels.push({ id: "label-1", user_id: "someone-else", state: "active" })
  const supabase = new FakeSupabase(db)

  await assert.rejects(
    () =>
      createIssue(
        supabase as never,
        "user-1",
        baseInput({ label_ids: ["label-1"] }) as never
      ),
    (error) => error instanceof ServiceError && error.code === "not_found"
  )
  assert.equal(db.issues.length, 0)
})

test("createIssue rejects a stale/archived label id and creates no issue", async () => {
  const db = new FakeDb()
  db.projects.push({ id: "project-1", user_id: "user-1" })
  db.labels.push({ id: "label-1", user_id: "user-1", state: "archived" })
  const supabase = new FakeSupabase(db)

  await assert.rejects(
    () =>
      createIssue(
        supabase as never,
        "user-1",
        baseInput({ label_ids: ["label-1", "missing-label"] }) as never
      ),
    (error) => error instanceof ServiceError && error.code === "not_found"
  )
  assert.equal(db.issues.length, 0)
})

test("createIssue rolls back the created issue when assignment fails", async () => {
  const db = new FakeDb()
  db.projects.push({ id: "project-1", user_id: "user-1" })
  db.labels.push({ id: "label-1", user_id: "user-1", state: "active" })
  db.forceIssueLabelInsertError = true
  const supabase = new FakeSupabase(db)

  await assert.rejects(
    () =>
      createIssue(
        supabase as never,
        "user-1",
        baseInput({ label_ids: ["label-1"] }) as never
      ),
    (error) => error instanceof ServiceError && error.code === "internal"
  )
  assert.equal(db.issues.length, 0)
  assert.equal(db.issue_labels.length, 0)
})
