import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "../errors"
import { listIssues } from "./queries"

type Row = Record<string, unknown>
type TableName = "issues" | "labels"

class FakeDb {
  issues: Row[] = []
  labels: Row[] = []
}

class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  private readonly eqFilters: Array<[string, unknown]> = []
  private readonly inFilters: Array<[string, unknown[]]> = []

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
    this.eqFilters.push([column, value])
    return this
  }

  in(column: string, values: unknown[]) {
    this.inFilters.push([column, values])
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
    return Promise.resolve({
      data: this.db[this.table].filter((row) => this.matches(row)),
      error: null,
    }).then(onfulfilled, onrejected)
  }

  private matches(row: Row) {
    return (
      this.eqFilters.every(([column, value]) => {
        if (column === "projects.user_id") {
          return (row.projects as Row).user_id === value
        }
        return row[column] === value
      }) &&
      this.inFilters.every(([column, values]) => values.includes(row[column]))
    )
  }
}

class FakeSupabase {
  constructor(readonly db: FakeDb) {}

  from(table: TableName) {
    return new FakeQuery(table, this.db)
  }
}

const activeLabels = [
  { id: "label-alpha", name: "Alpha", color: "#111111", state: "active" },
  { id: "label-beta", name: "beta", color: "#222222", state: "active" },
]

function assignment(label: (typeof activeLabels)[number]) {
  return { labels: label }
}

function seededDb() {
  const db = new FakeDb()
  db.labels.push(
    ...activeLabels.map((label) => ({ ...label, user_id: "user-1" })),
    {
      id: "label-archived",
      name: "Archived",
      color: "#333333",
      state: "archived",
      user_id: "user-1",
    },
    {
      id: "label-foreign",
      name: "Foreign",
      color: "#444444",
      state: "active",
      user_id: "user-2",
    }
  )
  db.issues.push(
    {
      id: "issue-both",
      created_at: "2026-08-05T12:00:00Z",
      projects: { user_id: "user-1" },
      issue_labels: [assignment(activeLabels[1]), assignment(activeLabels[0])],
    },
    {
      id: "issue-alpha",
      created_at: "2026-08-05T11:00:00Z",
      projects: { user_id: "user-1" },
      issue_labels: [assignment(activeLabels[0])],
    },
    {
      id: "issue-none",
      created_at: "2026-08-05T10:00:00Z",
      projects: { user_id: "user-1" },
      issue_labels: [],
    }
  )
  return db
}

test("listIssues matches every requested Label and returns sorted assignments", async () => {
  const db = seededDb()
  const issues = await listIssues(new FakeSupabase(db) as never, "user-1", {
    labelIds: ["label-alpha", "label-beta"],
  })

  assert.deepEqual(
    issues.map((issue) => issue.id),
    ["issue-both"]
  )
  assert.deepEqual(
    issues[0].labels.map((label) => label.name),
    ["Alpha", "beta"]
  )
})

test("listIssues unlabeled mode only returns issues without active Labels", async () => {
  const db = seededDb()
  const issues = await listIssues(new FakeSupabase(db) as never, "user-1", {
    unlabeled: true,
  })

  assert.deepEqual(
    issues.map((issue) => issue.id),
    ["issue-none"]
  )
})

test("listIssues rejects combining unlabeled mode with Label IDs", async () => {
  const db = seededDb()

  await assert.rejects(
    () =>
      listIssues(new FakeSupabase(db) as never, "user-1", {
        labelIds: ["label-alpha"],
        unlabeled: true,
      }),
    (error) => error instanceof ServiceError && error.code === "validation"
  )
})

test("listIssues clearly rejects missing, archived, and cross-account Label IDs", async () => {
  for (const labelId of ["missing", "label-archived", "label-foreign"]) {
    const db = seededDb()
    await assert.rejects(
      () =>
        listIssues(new FakeSupabase(db) as never, "user-1", {
          labelIds: [labelId],
        }),
      (error) =>
        error instanceof ServiceError &&
        error.code === "not_found" &&
        /missing, archived, or not owned/.test(error.message)
    )
  }
})
