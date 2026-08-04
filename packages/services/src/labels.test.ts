import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "./errors"
import { createLabel, listLabels, updateLabel } from "./labels"

type Row = Record<string, unknown>
type TableName = "labels" | "issue_labels"

class FakeSupabase {
  labels: Row[] = []
  issue_labels: Row[] = []

  from(table: TableName) {
    return new FakeQuery(table, this)
  }
}

class FakeQuery implements PromiseLike<unknown> {
  private readonly filters: Array<(row: Row) => boolean> = []
  private projection: string | null = null
  private op: "select" | "insert" | "update" = "select"
  private input: Row | null = null
  private returnSingle: "single" | "maybeSingle" | null = null
  private countOnly = false

  constructor(
    private readonly table: TableName,
    private readonly db: FakeSupabase
  ) {}

  select(columns = "*", options?: { count?: "exact"; head?: boolean }) {
    this.projection = columns
    this.countOnly = Boolean(options?.head)
    return this
  }

  returns() {
    return this
  }

  single() {
    this.returnSingle = "single"
    return this
  }

  maybeSingle() {
    this.returnSingle = "maybeSingle"
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

  insert(input: Row) {
    this.op = "insert"
    this.input = input
    return this
  }

  update(input: Row) {
    this.op = "update"
    this.input = input
    return this
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
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

  private project(row: Row) {
    if (!this.projection || this.projection === "*") {
      return { ...row }
    }
    return Object.fromEntries(
      this.projection.split(",").map((column) => [column, row[column]])
    )
  }

  private async execute() {
    if (this.countOnly) {
      return {
        data: null,
        error: null,
        count: this.rows().filter((row) => this.matches(row)).length,
      }
    }

    if (this.op === "insert") {
      const duplicate = this.db.labels.some(
        (row) =>
          row.user_id === this.input?.user_id &&
          String(row.name).toLocaleLowerCase() ===
            String(this.input?.name).toLocaleLowerCase()
      )
      if (duplicate) {
        return {
          data: null,
          error: { code: "23505", message: "duplicate key" },
        }
      }

      const row = {
        id: `label-${this.db.labels.length + 1}`,
        state: "active",
        created_at: "2026-08-04T00:00:00.000Z",
        updated_at: "2026-08-04T00:00:00.000Z",
        ...this.input,
      }
      this.db.labels.push(row)
      return { data: this.project(row), error: null }
    }

    if (this.op === "update") {
      const row = this.rows().find((candidate) => this.matches(candidate))
      if (!row) {
        return { data: null, error: null }
      }
      if (
        this.input?.name &&
        this.db.labels.some(
          (candidate) =>
            candidate !== row &&
            candidate.user_id === row.user_id &&
            String(candidate.name).toLocaleLowerCase() ===
              String(this.input?.name).toLocaleLowerCase()
        )
      ) {
        return {
          data: null,
          error: { code: "23505", message: "duplicate key" },
        }
      }
      Object.assign(row, this.input)
      return { data: this.project(row), error: null }
    }

    const rows = this.rows()
      .filter((row) => this.matches(row))
      .map((row) => this.project(row))
    if (this.returnSingle === "single") {
      return { data: rows[0] ?? null, error: null }
    }
    if (this.returnSingle === "maybeSingle") {
      return { data: rows[0] ?? null, error: null }
    }
    return { data: rows, error: null }
  }
}

test("listLabels returns active labels sorted with assignment counts", async () => {
  const db = seededDb()

  const labels = await listLabels(db as never, "user_alpha")

  assert.deepEqual(
    labels.map((label) => [label.name, label.assignment_count]),
    [
      ["Alpha", 2],
      ["beta", 1],
    ]
  )
})

test("listLabels searches case-insensitively and excludes archived labels", async () => {
  const db = seededDb()

  const labels = await listLabels(db as never, "user_alpha", { search: "ALP" })

  assert.deepEqual(
    labels.map((label) => label.name),
    ["Alpha"]
  )
})

test("createLabel rejects case-insensitive duplicates without merging", async () => {
  const db = seededDb()

  await assert.rejects(
    () =>
      createLabel(db as never, "user_alpha", {
        name: "alpha",
        color: "#2563EB",
      }),
    (error) =>
      error instanceof ServiceError &&
      error.code === "validation" &&
      /already exists/.test(error.message)
  )

  assert.equal(db.labels.filter((label) => label.user_id === "user_alpha").length, 3)
})

test("createLabel chooses from least-used preset colors when color is omitted", async () => {
  const db = seededDb()
  const originalRandom = Math.random
  Math.random = () => 0
  try {
    const label = await createLabel(db as never, "user_alpha", {
      name: "Gamma",
    })

    assert.equal(label.color, "#B91C1C")
  } finally {
    Math.random = originalRandom
  }
})

test("createLabel enforces the active catalog limit excluding archived labels", async () => {
  const db = new FakeSupabase()
  for (let index = 0; index < 100; index++) {
    db.labels.push(activeLabel(`active-${index}`, "user_alpha", `A${index}`))
  }
  db.labels.push({
    ...activeLabel("archived", "user_alpha", "Archived"),
    state: "archived",
  })

  await assert.rejects(
    () =>
      createLabel(db as never, "user_alpha", {
        name: "Too many",
        color: "#2563EB",
      }),
    (error) =>
      error instanceof ServiceError &&
      error.code === "validation" &&
      /limit/.test(error.message)
  )
})

test("updateLabel renames and recolors only active labels for the owner", async () => {
  const db = seededDb()

  const label = await updateLabel(db as never, "user_alpha", {
    id: "label-alpha",
    name: "Alpha Done",
    color: "#1D4ED8",
  })

  assert.equal(label.name, "Alpha Done")
  assert.equal(label.color, "#1D4ED8")
  await assert.rejects(
    () =>
      updateLabel(db as never, "user_alpha", {
        id: "label-gamma",
        color: "#1D4ED8",
      }),
    (error) => error instanceof ServiceError && error.code === "not_found"
  )
})

function activeLabel(id: string, userId: string, name: string): Row {
  return {
    id,
    user_id: userId,
    name,
    color: "#2563EB",
    state: "active",
    created_at: "2026-08-04T00:00:00.000Z",
    updated_at: "2026-08-04T00:00:00.000Z",
  }
}

function seededDb() {
  const db = new FakeSupabase()
  db.labels.push(activeLabel("label-alpha", "user_alpha", "Alpha"))
  db.labels.push(activeLabel("label-beta", "user_alpha", "beta"))
  db.labels.push({
    ...activeLabel("label-archived", "user_alpha", "Archived"),
    state: "archived",
  })
  db.labels.push(activeLabel("label-gamma", "user_beta", "Gamma"))
  db.issue_labels.push(
    { issue_id: "issue-1", label_id: "label-alpha" },
    { issue_id: "issue-2", label_id: "label-alpha" },
    { issue_id: "issue-3", label_id: "label-beta" },
    { issue_id: "issue-4", label_id: "label-gamma" }
  )
  return db
}
