import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "../errors"
import { getIssueReviewPolicy, listIssues } from "./queries"

type Row = Record<string, unknown>
type TableName = "issues" | "labels" | "issue_review_policies"

class FakeDb {
  issues: Row[] = []
  labels: Row[] = []
  issue_review_policies: Row[] = []
}

class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  private readonly eqFilters: Array<[string, unknown]> = []
  private readonly inFilters: Array<[string, unknown[]]> = []
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
  ) {
    const matched = this.db[this.table].filter((row) => this.matches(row))
    return Promise.resolve({
      data: this.wantsSingle ? (matched[0] ?? null) : matched,
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

test("getIssueReviewPolicy returns null before a policy is snapshotted", async () => {
  const db = new FakeDb()
  db.issues.push({ id: "issue-no-pr", projects: { user_id: "user-1" } })

  const policy = await getIssueReviewPolicy(
    new FakeSupabase(db) as never,
    "user-1",
    "issue-no-pr"
  )

  assert.equal(policy, null)
})

test("getIssueReviewPolicy returns the frozen snapshot once one exists", async () => {
  const db = new FakeDb()
  db.issues.push({ id: "issue-with-pr", projects: { user_id: "user-1" } })
  db.issue_review_policies.push({
    issue_id: "issue-with-pr",
    enabled: true,
    reviewer_provider: "claude_code",
    reviewer_model: "claude-opus-5",
    reviewer_instructions: null,
    created_at: "2026-08-19T00:00:00Z",
  })

  const policy = await getIssueReviewPolicy(
    new FakeSupabase(db) as never,
    "user-1",
    "issue-with-pr"
  )

  assert.deepEqual(policy, {
    issue_id: "issue-with-pr",
    enabled: true,
    reviewer_provider: "claude_code",
    reviewer_model: "claude-opus-5",
    reviewer_instructions: null,
    created_at: "2026-08-19T00:00:00Z",
  })
})

test("getIssueReviewPolicy rejects an issue owned by another account", async () => {
  const db = new FakeDb()
  db.issues.push({ id: "issue-foreign", projects: { user_id: "user-2" } })

  await assert.rejects(
    getIssueReviewPolicy(new FakeSupabase(db) as never, "user-1", "issue-foreign"),
    (error) => error instanceof ServiceError && error.code === "not_found"
  )
})
