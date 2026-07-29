import assert from "node:assert/strict"
import { test } from "node:test"

import {
  attachIssuePullRequest,
  bulkUpdateIssuePriority,
  bulkUpdateIssueStatus,
  updateIssuePriority,
  updateIssueStatus,
  updateIssueStatusByPrUrl,
  updateIssueStatusByPrUrlIfStatus,
} from "./workflow"
import { createIssue, updateIssue } from "./mutations"

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
type TableName = "issues" | "issue_pull_requests" | "issue_events" | "projects"
type Filter =
  | { type: "eq"; column: string; value: unknown }
  | { type: "in"; column: string; values: unknown[] }

class EventLogDb {
  issues: Row[] = []
  issue_pull_requests: Row[] = []
  issue_events: Row[] = []
  projects: Row[] = []
  nextIssueNumber = 1
}

class EventLogQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Filter[] = []
  private op: "select" | "update" | "insert" | "upsert" = "select"
  private payload: Row | Row[] | null = null
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
    this.filters.push({ type: "eq", column: col, value: val })
    return this
  }

  in(col: string, vals: unknown[]) {
    this.filters.push({ type: "in", column: col, values: vals })
    return this
  }

  update(values: Row) {
    this.op = "update"
    this.payload = values
    return this
  }

  insert(values: Row | Row[]) {
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

  single() {
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

  private valueFor(row: Row, col: string): unknown {
    let value: unknown = row
    for (const part of col.split(".")) {
      value = (value as Row | undefined)?.[part]
    }
    return value
  }

  private matches(row: Row): boolean {
    return this.filters.every((filter) => {
      const value = this.valueFor(row, filter.column)
      if (filter.type === "in") {
        return filter.values.includes(value)
      }
      if (filter.column === "projects.user_id" && value === undefined) {
        const project = this.db.projects.find(
          (projectRow) => projectRow.id === row.project_id
        )
        return project?.user_id === filter.value
      }
      return value === filter.value
    })
  }

  private selected(row: Row | undefined): Row | null {
    if (!row) {
      return null
    }
    if (this.table !== "issues" || row.projects) {
      return { ...row }
    }
    const project = this.db.projects.find(
      (projectRow) => projectRow.id === row.project_id
    )
    return project ? { ...row, projects: { ...project } } : { ...row }
  }

  private payloadRows(): Row[] {
    const values = Array.isArray(this.payload) ? this.payload : [this.payload]
    return values.filter((value): value is Row => Boolean(value))
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
        .map((row) => this.selected(row))
      return {
        data: this.wantsSingle ? (matched[0] ?? null) : matched,
        error: null,
      }
    }

    if (this.op === "update") {
      const matched = this.rows().filter((row) => this.matches(row))
      matched.forEach((row) => Object.assign(row, this.payload as Row))
      if (!this.wantsSelectAfterWrite) {
        return { data: null, error: null }
      }
      return {
        data: this.wantsSingle
          ? this.selected(matched[0])
          : matched.map((row) => this.selected(row)),
        error: null,
      }
    }

    if (this.op === "insert") {
      const inserted = this.payloadRows().map((payload) => {
        const row: Row = {
          id: `${this.table}-${this.rows().length + 1}`,
          created_at: new Date().toISOString(),
          ...payload,
        }
        this.rows().push(row)
        return this.selected(row)
      })
      return {
        data: this.wantsSingle ? (inserted[0] ?? null) : inserted,
        error: null,
      }
    }

    // upsert
    const payload = this.payloadRows()[0]
    const conflictCol = this.upsertOpts.onConflict ?? "id"
    const existing = this.rows().find(
      (row) => row[conflictCol] === payload?.[conflictCol]
    )
    if (existing) {
      if (this.upsertOpts.ignoreDuplicates) {
        return { data: this.wantsSelectAfterWrite ? [] : null, error: null }
      }
      Object.assign(existing, payload)
      return {
        data: this.wantsSelectAfterWrite ? [existing] : null,
        error: null,
      }
    }
    const row: Row = {
      id: `${this.table}-${this.rows().length + 1}`,
      created_at: new Date().toISOString(),
      ...payload,
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

  rpc(name: string) {
    if (name === "next_issue_number_for_project") {
      return Promise.resolve({ data: this.db.nextIssueNumber++, error: null })
    }
    return Promise.resolve({ data: null, error: null })
  }
}

function issueRow(overrides: Row): Row {
  return {
    agent_provider: "claude_code",
    issue_model: null,
    number: 1,
    priority: "medium",
    prompt: null,
    project_id: "project-1",
    projects: { user_id: "user-1" },
    status: "todo",
    type: "issue",
    ...overrides,
  }
}

test("createIssue persists the requested priority", async () => {
  const db = new EventLogDb()
  db.projects.push({ id: "project-1", name: "Project", user_id: "user-1" })
  const supabase = new EventLogSupabase(db)

  const issue = (await createIssue(supabase as never, "user-1", {
    project_id: "project-1",
    title: "Prioritized issue",
    prompt: "Do the thing",
    status: "draft",
    priority: "urgent",
    create_pr_automatically: false,
    agent_provider: "claude_code",
    issue_model: null,
    type: "feature",
  })) as unknown as Row

  assert.equal(issue.priority, "urgent")
  assert.equal(db.issues[0]?.priority, "urgent")
})

test("createIssue persists explicit automatic PR preference", async () => {
  const db = new EventLogDb()
  db.projects.push({ id: "project-1", name: "Project", user_id: "user-1" })
  const supabase = new EventLogSupabase(db)

  const issue = (await createIssue(supabase as never, "user-1", {
    project_id: "project-1",
    title: "Automatic PR issue",
    prompt: "Do the thing",
    status: "draft",
    priority: "medium",
    create_pr_automatically: true,
    agent_provider: "claude_code",
    issue_model: null,
    type: "feature",
  })) as unknown as Row

  assert.equal(issue.create_pr_automatically, true)
  assert.equal(db.issues[0]?.create_pr_automatically, true)
})

test("updateIssue persists priority and logs priority_changed payload", async () => {
  const db = new EventLogDb()
  db.issues.push(issueRow({ id: "issue-full", priority: "low" }))
  const supabase = new EventLogSupabase(db)

  const issue = (await updateIssue(supabase as never, "user-1", "issue-full", {
    id: "issue-full",
    title: "Updated",
    prompt: "Updated prompt",
    agent_provider: "claude_code",
    issue_model: null,
    type: "bug",
    priority: "high",
  })) as unknown as Row

  assert.equal(issue.priority, "high")
  assert.equal(db.issues[0]?.priority, "high")
  assert.deepEqual(
    db.issue_events.map((event) => ({
      issue_id: event.issue_id,
      type: event.type,
      payload: event.payload,
    })),
    [
      {
        issue_id: "issue-full",
        type: "priority_changed",
        payload: { from: "low", to: "high" },
      },
    ]
  )
})

test("updateIssue persists automatic PR preference before a PR is attached", async () => {
  const db = new EventLogDb()
  db.issues.push(
    issueRow({
      id: "issue-automatic-pr",
      create_pr_automatically: true,
      pr_url: null,
    })
  )
  const supabase = new EventLogSupabase(db)

  const issue = (await updateIssue(
    supabase as never,
    "user-1",
    "issue-automatic-pr",
    {
      id: "issue-automatic-pr",
      title: "Updated",
      prompt: "Updated prompt",
      agent_provider: "claude_code",
      issue_model: null,
      type: "bug",
      priority: "medium",
      create_pr_automatically: false,
    }
  )) as unknown as Row

  assert.equal(issue.create_pr_automatically, false)
  assert.equal(db.issues[0]?.create_pr_automatically, false)
})

test("updateIssue leaves automatic PR preference historical after a PR is attached", async () => {
  const db = new EventLogDb()
  db.issues.push(
    issueRow({
      id: "issue-attached-pr",
      create_pr_automatically: true,
      pr_url: null,
    })
  )
  db.issue_pull_requests.push({
    id: "pull-request-1",
    issue_id: "issue-attached-pr",
    url: "https://github.com/acme/widget/pull/1",
  })
  const supabase = new EventLogSupabase(db)

  const issue = (await updateIssue(
    supabase as never,
    "user-1",
    "issue-attached-pr",
    {
      id: "issue-attached-pr",
      title: "Updated",
      prompt: "Updated prompt",
      agent_provider: "claude_code",
      issue_model: null,
      type: "bug",
      priority: "medium",
      create_pr_automatically: false,
    }
  )) as unknown as Row

  assert.equal(issue.create_pr_automatically, true)
  assert.equal(db.issues[0]?.create_pr_automatically, true)
})

test("updateIssue does not log priority_changed when priority is unchanged", async () => {
  const db = new EventLogDb()
  db.issues.push(issueRow({ id: "issue-full-noop", priority: "medium" }))
  const supabase = new EventLogSupabase(db)

  await updateIssue(supabase as never, "user-1", "issue-full-noop", {
    id: "issue-full-noop",
    title: "Updated",
    prompt: "Updated prompt",
    agent_provider: "claude_code",
    issue_model: null,
    type: "bug",
    priority: "medium",
  })

  assert.deepEqual(db.issue_events, [])
})

test("updateIssuePriority updates one owned issue and logs from/to payload", async () => {
  const db = new EventLogDb()
  db.issues.push(issueRow({ id: "issue-priority", priority: "low" }))
  const supabase = new EventLogSupabase(db)

  const issue = (await updateIssuePriority(
    supabase as never,
    "user-1",
    "issue-priority",
    "urgent"
  )) as unknown as Row

  assert.equal(issue.priority, "urgent")
  assert.equal(db.issues[0]?.priority, "urgent")
  assert.deepEqual(
    db.issue_events.map((event) => ({
      issue_id: event.issue_id,
      type: event.type,
      payload: event.payload,
    })),
    [
      {
        issue_id: "issue-priority",
        type: "priority_changed",
        payload: { from: "low", to: "urgent" },
      },
    ]
  )
})

test("updateIssuePriority is a no-op when priority is unchanged", async () => {
  const db = new EventLogDb()
  db.issues.push(issueRow({ id: "issue-priority-noop", priority: "medium" }))
  const supabase = new EventLogSupabase(db)

  const issue = (await updateIssuePriority(
    supabase as never,
    "user-1",
    "issue-priority-noop",
    "medium"
  )) as unknown as Row

  assert.equal(issue.priority, "medium")
  assert.deepEqual(db.issue_events, [])
})

test("bulkUpdateIssuePriority logs correct events for each changed issue", async () => {
  const db = new EventLogDb()
  db.issues.push(
    issueRow({ id: "issue-low", priority: "low" }),
    issueRow({ id: "issue-medium", priority: "medium" }),
    issueRow({ id: "issue-high", priority: "high" })
  )
  const supabase = new EventLogSupabase(db)

  await bulkUpdateIssuePriority(
    supabase as never,
    "user-1",
    ["issue-low", "issue-medium", "issue-high", "issue-low"],
    "high"
  )

  assert.deepEqual(
    db.issues.map((issue) => [issue.id, issue.priority]),
    [
      ["issue-low", "high"],
      ["issue-medium", "high"],
      ["issue-high", "high"],
    ]
  )
  assert.deepEqual(
    db.issue_events.map((event) => ({
      issue_id: event.issue_id,
      type: event.type,
      payload: event.payload,
    })),
    [
      {
        issue_id: "issue-low",
        type: "priority_changed",
        payload: { from: "low", to: "high" },
      },
      {
        issue_id: "issue-medium",
        type: "priority_changed",
        payload: { from: "medium", to: "high" },
      },
    ]
  )
})

test("bulkUpdateIssuePriority is a no-op when every priority is unchanged", async () => {
  const db = new EventLogDb()
  db.issues.push(
    issueRow({ id: "issue-high-1", priority: "high" }),
    issueRow({ id: "issue-high-2", priority: "high" })
  )
  const supabase = new EventLogSupabase(db)

  await bulkUpdateIssuePriority(
    supabase as never,
    "user-1",
    ["issue-high-1", "issue-high-2"],
    "high"
  )

  assert.deepEqual(db.issue_events, [])
})

test("priority updates preserve ownership not_found convention", async () => {
  const db = new EventLogDb()
  db.issues.push(
    issueRow({
      id: "other-user-issue",
      priority: "low",
      projects: { user_id: "user-2" },
    }),
    issueRow({ id: "owned-issue", priority: "low" })
  )
  const supabase = new EventLogSupabase(db)

  await assert.rejects(
    updateIssuePriority(
      supabase as never,
      "user-1",
      "other-user-issue",
      "urgent"
    ),
    { name: "ServiceError", code: "not_found", message: "Issue not found" }
  )
  await assert.rejects(
    bulkUpdateIssuePriority(
      supabase as never,
      "user-1",
      ["owned-issue", "other-user-issue"],
      "urgent"
    ),
    { name: "ServiceError", code: "not_found", message: "Issue not found" }
  )
  assert.deepEqual(
    db.issues.map((issue) => [issue.id, issue.priority]),
    [
      ["other-user-issue", "low"],
      ["owned-issue", "low"],
    ]
  )
  assert.deepEqual(db.issue_events, [])
})

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

test("updateIssueStatusByPrUrlIfStatus accepts multiple guarded source statuses", async () => {
  const db = new EventLogDb()
  db.issues.push(
    issueRow({
      id: "issue-9",
      status: "ready-for-review",
      pr_url: "https://github.com/acme/widget/pull/9",
    })
  )
  const supabase = new EventLogSupabase(db)

  await updateIssueStatusByPrUrlIfStatus(
    supabase as never,
    "https://github.com/acme/widget/pull/9",
    ["ready-for-review", "tests-failed"],
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

test("updateIssueStatusByPrUrlIfStatus logs nothing when no guarded source status matches", async () => {
  const db = new EventLogDb()
  db.issues.push(
    issueRow({
      id: "issue-10",
      status: "changes-requested",
      pr_url: "https://github.com/acme/widget/pull/10",
    })
  )
  const supabase = new EventLogSupabase(db)

  await updateIssueStatusByPrUrlIfStatus(
    supabase as never,
    "https://github.com/acme/widget/pull/10",
    ["ready-for-review", "tests-failed"],
    "testing"
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
