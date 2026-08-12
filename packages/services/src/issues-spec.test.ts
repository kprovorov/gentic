import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "./errors"
import { sendIssueMessage } from "./issues/chat"
import { createIssue, updateIssueType } from "./issues/mutations"
import { updateIssueStatus } from "./issues/workflow"

// A Spec is documentation, not agent work. The SQL functions refuse one
// outright (see supabase/tests/spec_issue_type_test.sql); these cover the
// service layer's half of that contract — it never asks for a run in the first
// place, and it turns the remaining refusals into ordinary validation errors.

const userId = "user_1"
const projectId = "3f14e45f-ceea-467e-b7ea-05a3e2b3f4c2"
const issueId = "8f14e45f-ceea-467e-b7ea-05a3e2b3f4c1"

type Row = Record<string, unknown>

class FakeSupabase {
  readonly rpcCalls: { name: string; args: Row }[] = []
  readonly inserted: Record<string, Row[]> = {}
  readonly updates: Row[] = []

  constructor(
    readonly issues: Row[] = [],
    readonly projects: Row[] = [{ id: projectId, user_id: userId }]
  ) {}

  from(table: string) {
    return new FakeQuery(table, this)
  }

  rpc(name: string, args: Row) {
    this.rpcCalls.push({ name, args })

    if (name === "next_issue_number_for_project") {
      return Promise.resolve({ data: 1, error: null })
    }
    if (name === "send_issue_user_message") {
      // The real function raises for a Spec; reaching it at all in these tests
      // means the service-layer guard let a Spec through.
      return new FakeSingle({
        id: "message-1",
        created_at: "2026-08-12T00:00:00.000Z",
      })
    }
    return Promise.resolve({ data: null, error: null })
  }
}

class FakeSingle implements PromiseLike<{ data: Row; error: null }> {
  constructor(private readonly data: Row) {}

  single() {
    return this
  }

  then<TResult1 = { data: Row; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: Row; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve({ data: this.data, error: null }).then(
      onfulfilled,
      onrejected
    )
  }
}

class FakeQuery implements PromiseLike<{ data: Row[]; error: null }> {
  private readonly filters: Row = {}
  private updateValues: Row | null = null
  private insertValues: Row | null = null

  constructor(
    private readonly table: string,
    private readonly db: FakeSupabase
  ) {}

  select() {
    return this
  }

  insert(values: Row) {
    this.insertValues = values
    this.db.inserted[this.table] ??= []
    this.db.inserted[this.table].push(values)
    return this
  }

  update(values: Row) {
    this.updateValues = values
    return this
  }

  eq(column: string, value: unknown) {
    this.filters[column] = value
    return this
  }

  maybeSingle() {
    return Promise.resolve({ data: this.matchingRows()[0] ?? null, error: null })
  }

  single() {
    return Promise.resolve({ data: this.matchingRows()[0] ?? null, error: null })
  }

  private matchingRows(): Row[] {
    if (this.insertValues) {
      return [{ ...this.insertValues, id: issueId, projects: this.db.projects[0] }]
    }

    const rows = this.table === "projects" ? this.db.projects : this.db.issues
    const matches = rows.filter((row) =>
      Object.entries(this.filters).every(([column, value]) => {
        if (column === "projects.user_id") {
          return this.db.projects.some(
            (project) =>
              project.id === row.project_id && project.user_id === value
          )
        }
        return row[column] === value
      })
    )

    if (this.updateValues) {
      for (const row of matches) {
        Object.assign(row, this.updateValues)
        this.db.updates.push(this.updateValues)
      }
    }

    return matches.map((row) => ({
      ...row,
      projects: this.db.projects.find(
        (project) => project.id === row.project_id
      ),
    }))
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve({ data: this.matchingRows(), error: null }).then(
      onfulfilled,
      onrejected
    )
  }
}

function issueRow(overrides: Row = {}): Row {
  return {
    id: issueId,
    project_id: projectId,
    number: 1,
    status: "draft",
    type: "feature",
    priority: "medium",
    agent_provider: "claude_code",
    issue_model: null,
    active_run_id: null,
    ...overrides,
  }
}

test("moving a spec from draft to todo never opens an agent run", async () => {
  const db = new FakeSupabase([issueRow({ type: "spec" })])

  await updateIssueStatus(db as never, userId, issueId, "todo")

  assert.deepEqual(db.rpcCalls, [])
  assert.equal(db.issues[0].status, "todo")
})

test("moving agent work from draft to todo still opens a run", async () => {
  const db = new FakeSupabase([issueRow()])

  await updateIssueStatus(db as never, userId, issueId, "todo")

  assert.deepEqual(
    db.rpcCalls.map((call) => call.name),
    ["start_issue_from_draft"]
  )
})

test("creating a spec directly in todo skips the run-opening RPC", async () => {
  const db = new FakeSupabase()

  const issue = await createIssue(db as never, userId, {
    project_id: projectId,
    status: "todo",
    type: "spec",
    priority: "medium",
    create_pr_automatically: false,
    agent_provider: "claude_code",
    issue_model: null,
    label_ids: [],
  })

  assert.equal(issue.status, "todo")
  assert.deepEqual(
    db.rpcCalls.map((call) => call.name),
    ["next_issue_number_for_project"]
  )
})

test("a spec has no conversation to send into", async () => {
  const db = new FakeSupabase([issueRow({ type: "spec" })])

  await assert.rejects(
    sendIssueMessage(db as never, userId, issueId, "Please build this"),
    (error: unknown) =>
      error instanceof ServiceError && error.code === "validation"
  )
  assert.deepEqual(db.rpcCalls, [])
})

test("an issue cannot become a spec while a run is active on it", async () => {
  const db = new FakeSupabase([issueRow({ active_run_id: "run-1" })])

  await assert.rejects(
    updateIssueType(db as never, userId, issueId, "spec"),
    (error: unknown) =>
      error instanceof ServiceError && error.code === "validation"
  )
  assert.equal(db.issues[0].type, "feature")
})

test("an issue with no active run becomes a spec", async () => {
  const db = new FakeSupabase([issueRow({ status: "ready-for-review" })])

  await updateIssueType(db as never, userId, issueId, "spec")

  assert.equal(db.issues[0].type, "spec")
})
