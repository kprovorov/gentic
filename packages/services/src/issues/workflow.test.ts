import assert from "node:assert/strict"
import { test } from "node:test"

import { bulkUpdateIssueStatus } from "./workflow"

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
