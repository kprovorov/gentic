import assert from "node:assert/strict"
import test from "node:test"

import { recordIssueUnpublishedChanges } from "../app/api/v1/agent/issues/[id]/unpublished-changes/route"

const runId1 = "11111111-1111-4111-8111-111111111111"
const runId2 = "22222222-2222-4222-8222-222222222222"
const hostId = "33333333-3333-4333-8333-333333333333"

type IssueRow = {
  id: string
  project_user_id: string
  active_host_id: string | null
  active_run_id: string | null
  has_unpublished_agent_changes: boolean
}

type HostRow = {
  id: string
  user_id: string
  banned_at: string | null
  last_seen_at: string | null
}

class FakeIssuesQuery {
  private filters: Record<string, unknown> = {}
  private updateValues: Record<string, unknown> | null = null
  private selectingOwnership = false

  constructor(private readonly db: FakeSupabase) {}

  select(columns: string) {
    this.selectingOwnership = columns.includes("projects!inner")
    return this
  }

  update(values: Record<string, unknown>) {
    this.updateValues = values
    return this
  }

  eq(column: string, value: unknown) {
    this.filters[column] = value
    return this
  }

  maybeSingle() {
    const row = this.db.issues.find((issue) => this.matches(issue))

    if (this.updateValues) {
      if (!row) {
        return Promise.resolve({ data: null, error: null })
      }
      Object.assign(row, this.updateValues)
      return Promise.resolve({ data: { id: row.id }, error: null })
    }

    if (!row) {
      return Promise.resolve({ data: null, error: null })
    }
    if (this.selectingOwnership) {
      return Promise.resolve({
        data: {
          id: row.id,
          active_host_id: row.active_host_id,
          active_run_id: row.active_run_id,
          projects: { user_id: row.project_user_id },
        },
        error: null,
      })
    }
    return Promise.resolve({ data: row, error: null })
  }

  private matches(row: IssueRow): boolean {
    return Object.entries(this.filters).every(([column, value]) => {
      if (column === "id") return row.id === value
      if (column === "projects.user_id") return row.project_user_id === value
      if (column === "active_run_id") return row.active_run_id === value
      return true
    })
  }
}

class FakeHostsQuery {
  private filters: Record<string, unknown> = {}

  constructor(private readonly db: FakeSupabase) {}

  select() {
    return this
  }

  eq(column: string, value: unknown) {
    this.filters[column] = value
    return this
  }

  maybeSingle() {
    const row = this.db.hosts.find((host) =>
      Object.entries(this.filters).every(([column, value]) => {
        if (column === "id") return host.id === value
        if (column === "user_id") return host.user_id === value
        return true
      })
    )

    return {
      returns<T>() {
        return Promise.resolve({ data: (row ?? null) as T, error: null })
      },
    }
  }
}

class FakeSupabase {
  constructor(
    readonly issues: IssueRow[],
    readonly hosts: HostRow[] = [
      {
        id: hostId,
        user_id: "user-1",
        banned_at: null,
        last_seen_at: new Date().toISOString(),
      },
    ]
  ) {}

  from(table: string) {
    if (table === "hosts") {
      return new FakeHostsQuery(this)
    }
    assert.equal(table, "issues")
    return new FakeIssuesQuery(this)
  }
}

function issue(overrides: Partial<IssueRow> & Pick<IssueRow, "id">): IssueRow {
  return {
    project_user_id: "user-1",
    active_host_id: hostId,
    active_run_id: runId1,
    has_unpublished_agent_changes: false,
    ...overrides,
  }
}

test("rejects a malformed body before touching supabase", async () => {
  const supabase = new FakeSupabase([issue({ id: "issue-1" })])

  await assert.rejects(
    recordIssueUnpublishedChanges(
      supabase as never,
      "user-1",
      hostId,
      "issue-1",
      {
        active_run_id: runId1,
      }
    ),
    { name: "ZodError" }
  )
})

test("rejects when the issue does not belong to the caller", async () => {
  const supabase = new FakeSupabase([
    issue({ id: "issue-1", project_user_id: "someone-else" }),
  ])

  await assert.rejects(
    recordIssueUnpublishedChanges(
      supabase as never,
      "user-1",
      hostId,
      "issue-1",
      {
        active_run_id: runId1,
        has_unpublished_agent_changes: true,
      }
    ),
    { status: 404, message: "Issue not found" }
  )
})

test("rejects a stale or superseded run", async () => {
  const supabase = new FakeSupabase([
    issue({ id: "issue-1", active_run_id: runId1 }),
  ])

  await assert.rejects(
    recordIssueUnpublishedChanges(
      supabase as never,
      "user-1",
      hostId,
      "issue-1",
      {
        active_run_id: runId2,
        has_unpublished_agent_changes: true,
      }
    ),
    { status: 409, message: "Run is not active for this host" }
  )
  assert.equal(supabase.issues[0]?.has_unpublished_agent_changes, false)
})

test("records unpublished changes for the issue's active run", async () => {
  const supabase = new FakeSupabase([
    issue({ id: "issue-1", active_run_id: runId1 }),
  ])

  const result = await recordIssueUnpublishedChanges(
    supabase as never,
    "user-1",
    hostId,
    "issue-1",
    { active_run_id: runId1, has_unpublished_agent_changes: true }
  )

  assert.deepEqual(result, { ok: true })
  assert.equal(supabase.issues[0]?.has_unpublished_agent_changes, true)
})

test("keeps an active run writable during the host heartbeat grace period", async () => {
  const supabase = new FakeSupabase(
    [issue({ id: "issue-1", active_run_id: runId1 })],
    [
      {
        id: hostId,
        user_id: "user-1",
        banned_at: null,
        last_seen_at: new Date(Date.now() - 2 * 60_000).toISOString(),
      },
    ]
  )

  const result = await recordIssueUnpublishedChanges(
    supabase as never,
    "user-1",
    hostId,
    "issue-1",
    { active_run_id: runId1, has_unpublished_agent_changes: true }
  )

  assert.deepEqual(result, { ok: true })
  assert.equal(supabase.issues[0]?.has_unpublished_agent_changes, true)
})
