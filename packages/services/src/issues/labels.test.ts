import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "../errors"
import { addIssueLabels, removeIssueLabels } from "./labels"

type Row = Record<string, unknown>
type TableName = "projects" | "issues" | "labels" | "issue_labels" | "issue_events"

// Minimal fake covering exactly the query shapes `addIssueLabels`/
// `removeIssueLabels` use: the `projects!inner(user_id)` ownership join
// (`ensureIssuesOwned`), label validation (`ensureLabelsAssignable`),
// bulk insert/delete on `issue_labels`, and bulk insert on `issue_events`.
class FakeDb {
  projects: Row[] = []
  issues: Row[] = []
  labels: Row[] = []
  issue_labels: Row[] = []
  issue_events: Row[] = []
}

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private readonly eqFilters: Array<[string, unknown]> = []
  private readonly inFilters: Array<[string, unknown[]]> = []
  private op: "select" | "insert" | "delete" = "select"
  private payload: Row | Row[] | null = null

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
    this.eqFilters.push([column, value])
    return this
  }

  in(column: string, values: unknown[]) {
    this.inFilters.push([column, values])
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

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>)
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

  private matches(row: Row): boolean {
    return (
      this.eqFilters.every(([column, value]) => {
        if (column === "projects.user_id") {
          return (row.projects as Row | undefined)?.user_id === value
        }
        return row[column] === value
      }) &&
      this.inFilters.every(([column, values]) => values.includes(row[column]))
    )
  }

  private async execute(): Promise<{ data: unknown; error: unknown }> {
    if (this.op === "insert") {
      const values = Array.isArray(this.payload) ? this.payload : [this.payload as Row]
      const inserted = values.map((value) => {
        const row: Row = { id: `${this.table}-${this.rows().length + 1}`, ...value }
        this.rows().push(row)
        return row
      })
      return { data: inserted, error: null }
    }

    if (this.op === "delete") {
      this.setRows(this.rows().filter((row) => !this.matches(row)))
      return { data: null, error: null }
    }

    return { data: this.rows().filter((row) => this.matches(row)), error: null }
  }
}

class FakeSupabase {
  constructor(readonly db: FakeDb) {}

  from(table: TableName) {
    return new FakeQuery(table, this.db)
  }
}

function seededDb() {
  const db = new FakeDb()
  db.projects.push({ id: "project-1", user_id: "user-1" })
  db.issues.push(
    { id: "issue-1", projects: { user_id: "user-1" } },
    { id: "issue-2", projects: { user_id: "user-1" } }
  )
  db.labels.push(
    { id: "label-1", user_id: "user-1", state: "active", name: "Bug", color: "#FF0000" },
    { id: "label-2", user_id: "user-1", state: "active", name: "Feature", color: "#00FF00" }
  )
  return db
}

test("addIssueLabels inserts new pairs and logs one event per changed issue", async () => {
  const db = seededDb()
  const supabase = new FakeSupabase(db)

  await addIssueLabels(supabase as never, "user-1", ["issue-1"], ["label-1", "label-2"])

  assert.deepEqual(
    db.issue_labels.map((row) => row.label_id).sort(),
    ["label-1", "label-2"]
  )
  assert.equal(db.issue_events.length, 1)
  const event = db.issue_events[0] as Row & {
    payload: { added: Row[]; removed: Row[] }
  }
  assert.equal(event.issue_id, "issue-1")
  assert.equal(event.type, "labels_changed")
  assert.deepEqual(
    event.payload.added.map((label) => label.id).sort(),
    ["label-1", "label-2"]
  )
  assert.deepEqual(event.payload.removed, [])
})

test("addIssueLabels is a full no-op when all labels already assigned and emits no event", async () => {
  const db = seededDb()
  db.issue_labels.push({ issue_id: "issue-1", label_id: "label-1" })
  const supabase = new FakeSupabase(db)

  await addIssueLabels(supabase as never, "user-1", ["issue-1"], ["label-1"])

  assert.equal(db.issue_labels.length, 1)
  assert.equal(db.issue_events.length, 0)
})

test("addIssueLabels only logs newly-added labels when partially idempotent", async () => {
  const db = seededDb()
  db.issue_labels.push({ issue_id: "issue-1", label_id: "label-1" })
  const supabase = new FakeSupabase(db)

  await addIssueLabels(supabase as never, "user-1", ["issue-1"], ["label-1", "label-2"])

  assert.deepEqual(
    db.issue_labels.map((row) => row.label_id).sort(),
    ["label-1", "label-2"]
  )
  const event = db.issue_events[0] as Row & { payload: { added: Row[] } }
  assert.deepEqual(
    event.payload.added.map((label) => label.id),
    ["label-2"]
  )
})

test("addIssueLabels rejects a single issue exceeding the 20-label limit with no writes", async () => {
  const db = seededDb()
  for (let index = 0; index < 19; index++) {
    const labelId = `extra-label-${index}`
    db.labels.push({ id: labelId, user_id: "user-1", state: "active", name: labelId, color: "#111111" })
    db.issue_labels.push({ issue_id: "issue-1", label_id: labelId })
  }
  const supabase = new FakeSupabase(db)

  await assert.rejects(
    () => addIssueLabels(supabase as never, "user-1", ["issue-1"], ["label-1", "label-2"]),
    (error) => error instanceof ServiceError && error.code === "validation"
  )
  assert.equal(db.issue_labels.length, 19)
  assert.equal(db.issue_events.length, 0)
})

test("addIssueLabels rejects the whole batch when only one of several issues would exceed the limit", async () => {
  const db = seededDb()
  for (let index = 0; index < 19; index++) {
    const labelId = `extra-label-${index}`
    db.labels.push({ id: labelId, user_id: "user-1", state: "active", name: labelId, color: "#111111" })
    db.issue_labels.push({ issue_id: "issue-1", label_id: labelId })
  }
  const supabase = new FakeSupabase(db)

  await assert.rejects(
    () =>
      addIssueLabels(
        supabase as never,
        "user-1",
        ["issue-1", "issue-2"],
        ["label-1", "label-2"]
      ),
    (error) => error instanceof ServiceError && error.code === "validation"
  )
  assert.equal(db.issue_labels.length, 19)
  assert.equal(db.issue_events.length, 0)
})

test("addIssueLabels applies atomically across issues from different projects owned by the same account", async () => {
  const db = seededDb()
  db.projects.push({ id: "project-2", user_id: "user-1" })
  db.issues.push({ id: "issue-3", projects: { user_id: "user-1" } })
  const supabase = new FakeSupabase(db)

  await addIssueLabels(
    supabase as never,
    "user-1",
    ["issue-1", "issue-3"],
    ["label-1"]
  )

  assert.deepEqual(
    db.issue_labels
      .filter((row) => row.label_id === "label-1")
      .map((row) => row.issue_id)
      .sort(),
    ["issue-1", "issue-3"]
  )
  assert.equal(db.issue_events.length, 2)
  assert.deepEqual(
    db.issue_events.map((event) => event.issue_id).sort(),
    ["issue-1", "issue-3"]
  )
})

test("removeIssueLabels applies atomically across issues from different projects owned by the same account", async () => {
  const db = seededDb()
  db.projects.push({ id: "project-2", user_id: "user-1" })
  db.issues.push({ id: "issue-3", projects: { user_id: "user-1" } })
  db.issue_labels.push(
    { issue_id: "issue-1", label_id: "label-1" },
    { issue_id: "issue-3", label_id: "label-1" }
  )
  const supabase = new FakeSupabase(db)

  await removeIssueLabels(
    supabase as never,
    "user-1",
    ["issue-1", "issue-3"],
    ["label-1"]
  )

  assert.equal(db.issue_labels.length, 0)
  assert.equal(db.issue_events.length, 2)
  assert.deepEqual(
    db.issue_events.map((event) => event.issue_id).sort(),
    ["issue-1", "issue-3"]
  )
})

test("addIssueLabels rejects a cross-account issue id", async () => {
  const db = seededDb()
  db.issues.push({ id: "issue-other", projects: { user_id: "someone-else" } })
  const supabase = new FakeSupabase(db)

  await assert.rejects(
    () => addIssueLabels(supabase as never, "user-1", ["issue-other"], ["label-1"]),
    (error) => error instanceof ServiceError && error.code === "not_found"
  )
  assert.equal(db.issue_labels.length, 0)
})

test("addIssueLabels rejects a cross-account, missing, or archived label id", async () => {
  const db = seededDb()
  db.labels.push({ id: "label-archived", user_id: "user-1", state: "archived", name: "Old", color: "#000000" })
  db.labels.push({ id: "label-foreign", user_id: "someone-else", state: "active", name: "Theirs", color: "#000000" })
  const supabase = new FakeSupabase(db)

  await assert.rejects(
    () => addIssueLabels(supabase as never, "user-1", ["issue-1"], ["label-archived"]),
    (error) => error instanceof ServiceError && error.code === "not_found"
  )
  await assert.rejects(
    () => addIssueLabels(supabase as never, "user-1", ["issue-1"], ["label-foreign"]),
    (error) => error instanceof ServiceError && error.code === "not_found"
  )
  await assert.rejects(
    () => addIssueLabels(supabase as never, "user-1", ["issue-1"], ["missing-label"]),
    (error) => error instanceof ServiceError && error.code === "not_found"
  )
  assert.equal(db.issue_labels.length, 0)
})

test("removeIssueLabels deletes assigned pairs and logs removed snapshots", async () => {
  const db = seededDb()
  db.issue_labels.push({ issue_id: "issue-1", label_id: "label-1" })
  const supabase = new FakeSupabase(db)

  await removeIssueLabels(supabase as never, "user-1", ["issue-1"], ["label-1"])

  assert.equal(db.issue_labels.length, 0)
  assert.equal(db.issue_events.length, 1)
  const event = db.issue_events[0] as Row & {
    payload: { added: Row[]; removed: Row[] }
  }
  assert.equal(event.issue_id, "issue-1")
  assert.deepEqual(event.payload.added, [])
  assert.deepEqual(
    event.payload.removed.map((label) => label.id),
    ["label-1"]
  )
})

test("removeIssueLabels is a no-op when the label was not assigned", async () => {
  const db = seededDb()
  const supabase = new FakeSupabase(db)

  await removeIssueLabels(supabase as never, "user-1", ["issue-1"], ["label-1"])

  assert.equal(db.issue_events.length, 0)
})

test("removeIssueLabels preserves unrelated assignments", async () => {
  const db = seededDb()
  db.issue_labels.push(
    { issue_id: "issue-1", label_id: "label-1" },
    { issue_id: "issue-1", label_id: "label-2" },
    { issue_id: "issue-2", label_id: "label-1" }
  )
  const supabase = new FakeSupabase(db)

  await removeIssueLabels(supabase as never, "user-1", ["issue-1"], ["label-1"])

  assert.deepEqual(
    db.issue_labels
      .filter((row) => row.issue_id === "issue-1")
      .map((row) => row.label_id),
    ["label-2"]
  )
  assert.deepEqual(
    db.issue_labels
      .filter((row) => row.issue_id === "issue-2")
      .map((row) => row.label_id),
    ["label-1"]
  )
})

test("removeIssueLabels works when the issue is already at the 20-label limit", async () => {
  const db = seededDb()
  db.issue_labels.push({ issue_id: "issue-1", label_id: "label-1" })
  for (let index = 0; index < 19; index++) {
    const labelId = `extra-label-${index}`
    db.labels.push({ id: labelId, user_id: "user-1", state: "active", name: labelId, color: "#111111" })
    db.issue_labels.push({ issue_id: "issue-1", label_id: labelId })
  }
  const supabase = new FakeSupabase(db)

  await removeIssueLabels(supabase as never, "user-1", ["issue-1"], ["label-1"])

  assert.equal(db.issue_labels.filter((row) => row.issue_id === "issue-1").length, 19)
})
