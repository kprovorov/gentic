import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "./errors"
import {
  archiveLabel,
  createLabel,
  ensureLabelsAssignable,
  listArchivedLabelIds,
  listLabels,
  updateLabel,
} from "./labels"

type Row = Record<string, unknown>
type TableName = "labels" | "issue_labels" | "issue_events"

class FakeSupabase {
  labels: Row[] = []
  issue_labels: Row[] = []
  issue_events: Row[] = []
  // Set to model the RPC's transaction aborting: because `archive_label`
  // does all its work in one statement, a failure must leave every table
  // exactly as it was.
  rpcError: { message: string } | null = null

  from(table: TableName) {
    return new FakeQuery(table, this)
  }

  rpc(name: string, args: Record<string, unknown>) {
    assert.equal(name, "archive_label")

    if (this.rpcError) {
      return new FakeRpcQuery(null, this.rpcError)
    }

    const label = this.labels.find(
      (row) =>
        row.id === args.p_label_id &&
        row.user_id === args.p_user_id &&
        row.state === "active"
    )
    if (!label) {
      return new FakeRpcQuery(null)
    }

    const affectedIssueIds = this.issue_labels
      .filter((row) => row.label_id === args.p_label_id)
      .map((row) => row.issue_id)
    this.issue_labels = this.issue_labels.filter(
      (row) => row.label_id !== args.p_label_id
    )
    for (const issueId of affectedIssueIds) {
      this.issue_events.push({
        issue_id: issueId,
        type: "labels_changed",
        payload: {
          added: [],
          removed: [{ id: label.id, name: label.name, color: label.color }],
        },
      })
    }

    label.state = "archived"
    label.archived_at = args.p_now ?? new Date().toISOString()
    label.updated_at = label.archived_at

    return new FakeRpcQuery({
      id: label.id,
      affected_issue_count: affectedIssueIds.length,
    })
  }
}

class FakeRpcQuery implements PromiseLike<unknown> {
  constructor(
    private readonly data: Row | null,
    private readonly error: { message: string } | null = null
  ) {}

  maybeSingle() {
    return this
  }

  returns() {
    return this
  }

  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve({ data: this.data, error: this.error }).then(
      onfulfilled,
      onrejected
    )
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
    if (column === "name_key") {
      // Model the `name_key = lower(name)` generated column so name lookups
      // match case-insensitively just like the real unique constraint.
      this.filters.push((row) => String(row.name).toLowerCase() === value)
    } else {
      this.filters.push((row) => row[column] === value)
    }
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
    const { label, restored } = await createLabel(db as never, "user_alpha", {
      name: "Gamma",
    })

    assert.equal(label.color, "#B91C1C")
    assert.equal(restored, false)
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

test("createLabel restores an archived label of the same name instead of duplicating", async () => {
  const db = seededDb()
  db.issue_events = []

  const { label, restored } = await createLabel(db as never, "user_alpha", {
    // Different casing and a different color than the archived "Archived"
    // (#2563EB) — neither should override the revived identity.
    name: "archived",
    color: "#7C3AED",
  })

  assert.equal(restored, true)
  assert.equal(label.id, "label-archived")
  assert.equal(label.name, "Archived")
  assert.equal(label.color, "#2563EB")
  assert.equal(label.state, "active")
  assert.equal(label.assignment_count, 0)

  // Restored in place: one row, active again, archived_at cleared.
  const matches = db.labels.filter((row) => row.name === "Archived")
  assert.equal(matches.length, 1)
  assert.equal(matches[0].state, "active")
  assert.equal(matches[0].archived_at, null)
  // Restoration is not an assignment change — no timeline events written.
  assert.equal(db.issue_events.length, 0)
})

test("createLabel restore does not resurrect the label's former issue assignments", async () => {
  const db = seededDb()
  // "beta" carries one assignment (issue-3); archiving strips it, and
  // recreating the name must not bring the assignment back.
  await archiveLabel(db as never, "user_alpha", "label-beta")
  db.issue_events = []

  const { label, restored } = await createLabel(db as never, "user_alpha", {
    name: "BETA",
  })

  assert.equal(restored, true)
  assert.equal(label.id, "label-beta")
  assert.equal(label.name, "beta")
  assert.equal(label.assignment_count, 0)
  assert.equal(
    db.issue_labels.some((row) => row.label_id === "label-beta"),
    false
  )
  assert.equal(db.issue_events.length, 0)
})

test("createLabel restore obeys the active limit and fails atomically when full", async () => {
  const db = new FakeSupabase()
  for (let index = 0; index < 100; index++) {
    db.labels.push(activeLabel(`active-${index}`, "user_alpha", `A${index}`))
  }
  db.labels.push({
    ...activeLabel("label-archived", "user_alpha", "Reusable"),
    state: "archived",
  })

  await assert.rejects(
    () => createLabel(db as never, "user_alpha", { name: "reusable" }),
    (error) =>
      error instanceof ServiceError &&
      error.code === "validation" &&
      /limit/.test(error.message)
  )

  // A full catalog blocks the restore without half-changing the row.
  assert.equal(
    db.labels.find((row) => row.id === "label-archived")?.state,
    "archived"
  )
})

test("listLabels search matching an archived name never restores or mutates it", async () => {
  const db = seededDb()

  const labels = await listLabels(db as never, "user_alpha", {
    search: "archived",
  })

  assert.deepEqual(labels, [])
  assert.equal(
    db.labels.find((row) => row.id === "label-archived")?.state,
    "archived"
  )
})

test("ensureLabelsAssignable rejects an archived label id without restoring it", async () => {
  const db = seededDb()

  await assert.rejects(
    () =>
      ensureLabelsAssignable(db as never, "user_alpha", ["label-archived"]),
    (error) => error instanceof ServiceError && error.code === "not_found"
  )
  assert.equal(
    db.labels.find((row) => row.id === "label-archived")?.state,
    "archived"
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

test("updateLabel never writes per-issue timeline events for rename/recolor", async () => {
  const db = seededDb()

  await updateLabel(db as never, "user_alpha", {
    id: "label-alpha",
    name: "Alpha Renamed",
  })

  assert.equal(db.issue_events.length, 0)
})

test("archiveLabel with zero assignments archives the label and reports zero affected issues", async () => {
  const db = seededDb()
  db.labels.push(activeLabel("label-unused", "user_alpha", "Unused"))

  const result = await archiveLabel(db as never, "user_alpha", "label-unused")

  assert.deepEqual(result, { archived: true, affected_issue_count: 0 })
  assert.equal(
    db.labels.find((label) => label.id === "label-unused")?.state,
    "archived"
  )
  assert.equal(db.issue_events.length, 0)
})

test("archiveLabel with one assignment removes it and records one grouped event", async () => {
  const db = seededDb()

  const result = await archiveLabel(db as never, "user_alpha", "label-beta")

  assert.deepEqual(result, { archived: true, affected_issue_count: 1 })
  assert.equal(
    db.issue_labels.some((row) => row.label_id === "label-beta"),
    false
  )
  assert.equal(db.issue_events.length, 1)
  assert.deepEqual(db.issue_events[0], {
    issue_id: "issue-3",
    type: "labels_changed",
    payload: {
      added: [],
      removed: [{ id: "label-beta", name: "beta", color: "#2563EB" }],
    },
  })
})

test("archiveLabel with a high assignment count removes every assignment and groups one event per issue", async () => {
  const db = seededDb()
  db.labels.push(activeLabel("label-popular", "user_alpha", "Popular"))
  for (let index = 0; index < 250; index++) {
    db.issue_labels.push({
      issue_id: `bulk-issue-${index}`,
      label_id: "label-popular",
    })
  }

  const result = await archiveLabel(db as never, "user_alpha", "label-popular")

  assert.deepEqual(result, { archived: true, affected_issue_count: 250 })
  assert.equal(
    db.issue_labels.some((row) => row.label_id === "label-popular"),
    false
  )
  // Exactly one grouped removal event per affected issue — not one per
  // assignment, and none for issues that never carried the label.
  assert.equal(db.issue_events.length, 250)
  assert.equal(
    new Set(db.issue_events.map((event) => event.issue_id)).size,
    250
  )
})

test("archiveLabel frees a slot in the 100-active-label limit", async () => {
  const db = new FakeSupabase()
  for (let index = 0; index < 100; index++) {
    db.labels.push(activeLabel(`active-${index}`, "user_alpha", `A${index}`))
  }

  await archiveLabel(db as never, "user_alpha", "active-0")
  const { label } = await createLabel(db as never, "user_alpha", {
    name: "Now fits",
    color: "#2563EB",
  })

  assert.equal(label.name, "Now fits")
})

test("archiveLabel surfaces a failed transaction instead of reporting partial success", async () => {
  const db = seededDb()
  db.rpcError = { message: "could not serialize access" }

  await assert.rejects(
    () => archiveLabel(db as never, "user_alpha", "label-alpha"),
    (error) => error instanceof ServiceError && error.code === "internal"
  )
  // The RPC is one transaction: a failure leaves the label active, every
  // assignment in place, and no removal events behind.
  assert.equal(
    db.labels.find((label) => label.id === "label-alpha")?.state,
    "active"
  )
  assert.equal(
    db.issue_labels.filter((row) => row.label_id === "label-alpha").length,
    2
  )
  assert.equal(db.issue_events.length, 0)
})

test("archiveLabel rejects a label owned by another account without side effects", async () => {
  const db = seededDb()

  await assert.rejects(
    () => archiveLabel(db as never, "user_alpha", "label-gamma"),
    (error) => error instanceof ServiceError && error.code === "not_found"
  )
  assert.equal(
    db.labels.find((label) => label.id === "label-gamma")?.state,
    "active"
  )
  assert.equal(
    db.issue_labels.some((row) => row.label_id === "label-gamma"),
    true
  )
})

test("archiveLabel rejects an already-archived label instead of restoring it", async () => {
  const db = seededDb()

  await assert.rejects(
    () => archiveLabel(db as never, "user_alpha", "label-archived"),
    (error) => error instanceof ServiceError && error.code === "not_found"
  )
})

test("archiveLabel rejects a nonexistent label id", async () => {
  const db = seededDb()

  await assert.rejects(
    () => archiveLabel(db as never, "user_alpha", "label-missing"),
    (error) => error instanceof ServiceError && error.code === "not_found"
  )
})

test("listArchivedLabelIds returns only archived ids owned by the caller", async () => {
  const db = seededDb()
  db.labels.push({
    ...activeLabel("label-other-archived", "user_beta", "Other archived"),
    state: "archived",
  })

  const archivedIds = await listArchivedLabelIds(db as never, "user_alpha", [
    "label-alpha",
    "label-archived",
    "label-other-archived",
    "label-gamma",
  ])

  assert.deepEqual(Array.from(archivedIds).sort(), ["label-archived"])
})

test("listArchivedLabelIds returns an empty set without querying for an empty input", async () => {
  const db = seededDb()

  const archivedIds = await listArchivedLabelIds(db as never, "user_alpha", [])

  assert.deepEqual(archivedIds, new Set())
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
