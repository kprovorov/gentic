import assert from "node:assert/strict"
import { test } from "node:test"

import {
  bulkUpdateIssuePriority,
  bulkUpdateIssueStatus,
  recordUnpublishedAgentChanges,
  requestAutomaticPrPublish,
  resetIssueAgent,
  updateIssuePriority,
  updateIssueStatus,
  updateIssueStatusByPrUrl,
  updateIssueStatusByPrUrlIfStatus,
} from "./workflow"
import { createIssue, updateIssue } from "./mutations"
import { AUTOMATIC_REVIEW_OVERRIDE_LOCKED_MESSAGE } from "./shared"
import { ServiceError } from "../errors"

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
type TableName =
  | "issues"
  | "issue_pull_requests"
  | "issue_events"
  | "projects"
  | "issue_automatic_pr_requests"
  | "messages"
type Filter =
  | { type: "eq"; column: string; value: unknown }
  | { type: "in"; column: string; values: unknown[] }

class EventLogDb {
  issues: Row[] = []
  issue_pull_requests: Row[] = []
  issue_events: Row[] = []
  projects: Row[] = []
  issue_automatic_pr_requests: Row[] = []
  messages: Row[] = []
  nextIssueNumber = 1
}

class EventLogQuery implements PromiseLike<{ data: unknown; error: null }> {
  private filters: Filter[] = []
  private op: "select" | "update" | "insert" | "upsert" = "select"
  private payload: Row | Row[] | null = null
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {}
  private wantsSingle = false
  private wantsSelectAfterWrite = false
  private ordering: { column: string; ascending: boolean } | null = null
  private rowLimit: number | null = null

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

  order(column: string, opts: { ascending?: boolean } = {}) {
    this.ordering = { column, ascending: opts.ascending ?? true }
    return this
  }

  limit(count: number) {
    this.rowLimit = count
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
    if (this.table !== "issues") {
      return { ...row }
    }
    const project =
      row.projects ??
      this.db.projects.find((projectRow) => projectRow.id === row.project_id)
    const issuePullRequests = this.db.issue_pull_requests
      .filter((pullRequest) => pullRequest.issue_id === row.id)
      .map((pullRequest) => ({ id: pullRequest.id }))
    return {
      ...row,
      ...(project ? { projects: { ...(project as Row) } } : {}),
      issue_pull_requests: issuePullRequests,
    }
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
      let matched = this.rows()
        .filter((row) => this.matches(row))
        .map((row) => this.selected(row))
      if (this.ordering) {
        const { column, ascending } = this.ordering
        matched = matched.toSorted((left, right) =>
          String(left?.[column] ?? "").localeCompare(
            String(right?.[column] ?? "")
          )
        )
        if (!ascending) {
          matched.reverse()
        }
      }
      if (this.rowLimit !== null) {
        matched = matched.slice(0, this.rowLimit)
      }
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

  rpc(name: string, args?: Record<string, unknown>) {
    if (name === "next_issue_number_for_project") {
      return Promise.resolve({ data: this.db.nextIssueNumber++, error: null })
    }
    if (name === "request_automatic_pr_publish") {
      return this.requestAutomaticPrPublish(
        args as { p_issue_id: string; p_run_id: string; p_content: string }
      )
    }
    if (name === "reset_issue_run") {
      this.resetIssueRun(
        args as {
          p_issue_id: string
          p_agent_provider: string
          p_issue_model?: string
        }
      )
    }
    return Promise.resolve({ data: null, error: null })
  }

  // Mirrors 20260819150000_fix_reset_issue_run_dropped_pr_url.sql: the
  // transcript and pull-request links go, the run columns are cleared, and a
  // fresh kickoff message opens the new conversation.
  private resetIssueRun(args: {
    p_issue_id: string
    p_agent_provider: string
    p_issue_model?: string
  }) {
    this.db.messages = this.db.messages.filter(
      (row) => row.issue_id !== args.p_issue_id
    )
    this.db.issue_pull_requests = this.db.issue_pull_requests.filter(
      (row) => row.issue_id !== args.p_issue_id
    )

    const issue = this.db.issues.find((row) => row.id === args.p_issue_id)
    if (issue) {
      Object.assign(issue, {
        status: "todo",
        agent_provider: args.p_agent_provider,
        issue_model: args.p_issue_model ?? null,
        session_id: null,
        active_run_id: null,
        active_host_id: null,
        run_error: null,
        run_started_at: null,
        run_finished_at: null,
        usage_limit_reset_at: null,
      })
    }

    this.db.messages.push({
      id: "kickoff-message",
      issue_id: args.p_issue_id,
      role: "user",
      kind: "text",
      content: "Work on Gentic issue GEN-1.",
      status: "complete",
      author_type: "gentic",
      created_at: new Date().toISOString(),
    })
  }

  // Mirrors the `request_automatic_pr_publish` migration: the active-run
  // trigger rejects a mismatched run, and `on conflict (issue_id, run_id) do
  // nothing` means only the first caller for a given run inserts the request
  // + message — every later caller (concurrent or a retried/restarted
  // host) gets the same ids back with `created: false`.
  private requestAutomaticPrPublish(args: {
    p_issue_id: string
    p_run_id: string
    p_content: string
  }) {
    const issue = this.db.issues.find((row) => row.id === args.p_issue_id)
    if (!issue || issue.active_run_id !== args.p_run_id) {
      return {
        single: () =>
          Promise.resolve({
            data: null,
            error: {
              message:
                "Automatic pull request must target the issue active run",
            },
          }),
      }
    }

    let request = this.db.issue_automatic_pr_requests.find(
      (row) =>
        row.issue_id === args.p_issue_id && row.run_id === args.p_run_id
    )
    let created = false

    if (!request) {
      const messageId = `message-${this.db.messages.length + 1}`
      this.db.messages.push({
        id: messageId,
        issue_id: args.p_issue_id,
        role: "user",
        kind: "text",
        content: args.p_content,
        author_type: "gentic",
        generated_action: "create_pr",
      })
      request = {
        id: `request-${this.db.issue_automatic_pr_requests.length + 1}`,
        issue_id: args.p_issue_id,
        run_id: args.p_run_id,
        requested_by_message_id: messageId,
        status: "pending",
      }
      this.db.issue_automatic_pr_requests.push(request)
      created = true
    }

    return {
      single: () =>
        Promise.resolve({
          data: {
            request_id: request!.id,
            message_id: request!.requested_by_message_id,
            status: request!.status,
            created,
          },
          error: null,
        }),
    }
  }
}

function issueRow(overrides: Row): Row {
  return {
    agent_provider: "claude_code",
    issue_model: null,
    number: 1,
    priority: "medium",
    body: null,
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
    body: "Do the thing",
    status: "draft",
    priority: "urgent",
    create_pr_automatically: false,
    agent_provider: "claude_code",
    issue_model: null,
    type: "feature",
    label_ids: [],
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
    body: "Do the thing",
    status: "draft",
    priority: "medium",
    create_pr_automatically: true,
    agent_provider: "claude_code",
    issue_model: null,
    type: "feature",
    label_ids: [],
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
    body: "Updated body",
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
      body: "Updated body",
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
      body: "Updated body",
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

test("updateIssue persists an explicit automatic review override before a PR is attached", async () => {
  const db = new EventLogDb()
  db.issues.push(
    issueRow({ id: "issue-review-override", automatic_review_enabled: null })
  )
  const supabase = new EventLogSupabase(db)

  const issue = (await updateIssue(
    supabase as never,
    "user-1",
    "issue-review-override",
    {
      id: "issue-review-override",
      title: "Updated",
      body: "Updated body",
      agent_provider: "claude_code",
      issue_model: null,
      type: "bug",
      priority: "medium",
      automatic_review_enabled: true,
    }
  )) as unknown as Row

  assert.equal(issue.automatic_review_enabled, true)
  assert.equal(db.issues[0]?.automatic_review_enabled, true)
})

test("updateIssue leaves an omitted automatic review override untouched", async () => {
  const db = new EventLogDb()
  db.issues.push(
    issueRow({ id: "issue-review-untouched", automatic_review_enabled: true })
  )
  const supabase = new EventLogSupabase(db)

  await updateIssue(supabase as never, "user-1", "issue-review-untouched", {
    id: "issue-review-untouched",
    title: "Updated",
    body: "Updated body",
    agent_provider: "claude_code",
    issue_model: null,
    type: "bug",
    priority: "medium",
  })

  assert.equal(db.issues[0]?.automatic_review_enabled, true)
})

test("updateIssue rejects an automatic review override change after a PR is attached", async () => {
  const db = new EventLogDb()
  db.issues.push(
    issueRow({
      id: "issue-review-locked",
      automatic_review_enabled: false,
    })
  )
  db.issue_pull_requests.push({
    id: "pull-request-1",
    issue_id: "issue-review-locked",
    url: "https://github.com/acme/widget/pull/1",
  })
  const supabase = new EventLogSupabase(db)

  await assert.rejects(
    updateIssue(supabase as never, "user-1", "issue-review-locked", {
      id: "issue-review-locked",
      title: "Updated",
      body: "Updated body",
      agent_provider: "claude_code",
      issue_model: null,
      type: "bug",
      priority: "medium",
      automatic_review_enabled: true,
    }),
    (error: unknown) =>
      error instanceof ServiceError &&
      error.code === "validation" &&
      error.message === AUTOMATIC_REVIEW_OVERRIDE_LOCKED_MESSAGE
  )
  assert.equal(db.issues[0]?.automatic_review_enabled, false)
})

test("updateIssue allows re-submitting the same automatic review value after a PR is attached", async () => {
  const db = new EventLogDb()
  db.issues.push(
    issueRow({
      id: "issue-review-locked-noop",
      automatic_review_enabled: true,
    })
  )
  db.issue_pull_requests.push({
    id: "pull-request-1",
    issue_id: "issue-review-locked-noop",
    url: "https://github.com/acme/widget/pull/1",
  })
  const supabase = new EventLogSupabase(db)

  const issue = (await updateIssue(
    supabase as never,
    "user-1",
    "issue-review-locked-noop",
    {
      id: "issue-review-locked-noop",
      title: "Updated",
      body: "Updated body",
      agent_provider: "claude_code",
      issue_model: null,
      type: "bug",
      priority: "medium",
      automatic_review_enabled: true,
    }
  )) as unknown as Row

  assert.equal(issue.automatic_review_enabled, true)
})

test("updateIssue does not log priority_changed when priority is unchanged", async () => {
  const db = new EventLogDb()
  db.issues.push(issueRow({ id: "issue-full-noop", priority: "medium" }))
  const supabase = new EventLogSupabase(db)

  await updateIssue(supabase as never, "user-1", "issue-full-noop", {
    id: "issue-full-noop",
    title: "Updated",
    body: "Updated body",
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
    })
  )
  db.issue_pull_requests.push({
    id: "pr-5",
    issue_id: "issue-5",
    url: "https://github.com/acme/widget/pull/5",
  })
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
    })
  )
  db.issue_pull_requests.push({
    id: "pr-9",
    issue_id: "issue-9",
    url: "https://github.com/acme/widget/pull/9",
  })
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

test("recordUnpublishedAgentChanges records state for the issue's active run", async () => {
  const db = new EventLogDb()
  db.issues.push(
    issueRow({ id: "issue-run", active_run_id: "run-1" })
  )
  const supabase = new EventLogSupabase(db)

  await recordUnpublishedAgentChanges(
    supabase as never,
    "user-1",
    "issue-run",
    "run-1",
    true
  )

  assert.equal(db.issues[0]?.has_unpublished_agent_changes, true)
})

test("recordUnpublishedAgentChanges rejects a stale or superseded run", async () => {
  const db = new EventLogDb()
  db.issues.push(
    issueRow({
      id: "issue-run",
      active_run_id: "run-current",
      has_unpublished_agent_changes: false,
    })
  )
  const supabase = new EventLogSupabase(db)

  await assert.rejects(
    recordUnpublishedAgentChanges(
      supabase as never,
      "user-1",
      "issue-run",
      "run-stale",
      true
    ),
    { name: "ServiceError", code: "validation" }
  )
  assert.equal(db.issues[0]?.has_unpublished_agent_changes, false)
})

test("recordUnpublishedAgentChanges rejects issues owned by another user", async () => {
  const db = new EventLogDb()
  db.issues.push(
    issueRow({
      id: "issue-run",
      active_run_id: "run-1",
      projects: { user_id: "someone-else" },
    })
  )
  const supabase = new EventLogSupabase(db)

  await assert.rejects(
    recordUnpublishedAgentChanges(
      supabase as never,
      "user-1",
      "issue-run",
      "run-1",
      true
    ),
    { name: "ServiceError", code: "not_found" }
  )
})

function automaticPrIssueRow(overrides: Row = {}): Row {
  return issueRow({
    id: "issue-pr",
    active_run_id: "run-1",
    create_pr_automatically: true,
    has_unpublished_agent_changes: true,
    title: "Fix the thing",
    projects: { user_id: "user-1", key: "ACME" },
    ...overrides,
  })
}

test("requestAutomaticPrPublish inserts the request and a visible gentic user message", async () => {
  const db = new EventLogDb()
  db.issues.push(automaticPrIssueRow())
  const supabase = new EventLogSupabase(db)

  const result = await requestAutomaticPrPublish(
    supabase as never,
    "user-1",
    "issue-pr",
    "run-1"
  )

  assert.equal(result.created, true)
  assert.equal(result.issue.code, "ACME-1")
  assert.equal(result.issue.title, "Fix the thing")
  assert.equal(result.issue.activeRunId, "run-1")
  assert.equal(db.issue_automatic_pr_requests.length, 1)
  assert.equal(db.messages.length, 1)
  assert.equal(db.messages[0]?.role, "user")
  assert.equal(db.messages[0]?.author_type, "gentic")
  assert.equal(db.messages[0]?.generated_action, "create_pr")
  assert.match(
    String(db.messages[0]?.content),
    /`acme-1-fix-the-thing` branch/
  )
  assert.match(String(db.messages[0]?.content), /never create an empty commit/i)
  assert.match(
    String(db.messages[0]?.content),
    /summary section and a test plan section/i
  )
})

test("requestAutomaticPrPublish rejects a stale or superseded run", async () => {
  const db = new EventLogDb()
  db.issues.push(automaticPrIssueRow({ active_run_id: "run-current" }))
  const supabase = new EventLogSupabase(db)

  await assert.rejects(
    requestAutomaticPrPublish(
      supabase as never,
      "user-1",
      "issue-pr",
      "run-stale"
    ),
    { name: "ServiceError", code: "validation" }
  )
  assert.deepEqual(db.issue_automatic_pr_requests, [])
  assert.deepEqual(db.messages, [])
})

test("requestAutomaticPrPublish rejects issues owned by another user", async () => {
  const db = new EventLogDb()
  db.issues.push(
    automaticPrIssueRow({ projects: { user_id: "someone-else", key: "ACME" } })
  )
  const supabase = new EventLogSupabase(db)

  await assert.rejects(
    requestAutomaticPrPublish(
      supabase as never,
      "user-1",
      "issue-pr",
      "run-1"
    ),
    { name: "ServiceError", code: "not_found" }
  )
})

test("requestAutomaticPrPublish rejects when the issue is not opted into automatic PRs", async () => {
  const db = new EventLogDb()
  db.issues.push(automaticPrIssueRow({ create_pr_automatically: false }))
  const supabase = new EventLogSupabase(db)

  await assert.rejects(
    requestAutomaticPrPublish(
      supabase as never,
      "user-1",
      "issue-pr",
      "run-1"
    ),
    { name: "ServiceError", code: "validation" }
  )
})

test("requestAutomaticPrPublish rejects when a pull request already exists", async () => {
  const db = new EventLogDb()
  db.issues.push(automaticPrIssueRow())
  db.issue_pull_requests.push({
    id: "pr-automatic",
    issue_id: "issue-pr",
    url: "https://github.com/acme/widget/pull/1",
  })
  const supabase = new EventLogSupabase(db)

  await assert.rejects(
    requestAutomaticPrPublish(
      supabase as never,
      "user-1",
      "issue-pr",
      "run-1"
    ),
    { name: "ServiceError", code: "validation" }
  )
})

test("requestAutomaticPrPublish rejects a webhook-owned Associated Pull Request", async () => {
  const db = new EventLogDb()
  db.issues.push(automaticPrIssueRow())
  db.issue_pull_requests.push({
    id: "associated-pr-1",
    issue_id: "issue-pr",
    url: "https://github.com/acme/widget/pull/2",
    state: "open",
  })
  const supabase = new EventLogSupabase(db)

  await assert.rejects(
    requestAutomaticPrPublish(
      supabase as never,
      "user-1",
      "issue-pr",
      "run-1"
    ),
    { name: "ServiceError", code: "validation" }
  )
  assert.deepEqual(db.issue_automatic_pr_requests, [])
  assert.deepEqual(db.messages, [])
})

test("requestAutomaticPrPublish rejects when there are no unpublished changes", async () => {
  const db = new EventLogDb()
  db.issues.push(automaticPrIssueRow({ has_unpublished_agent_changes: false }))
  const supabase = new EventLogSupabase(db)

  await assert.rejects(
    requestAutomaticPrPublish(
      supabase as never,
      "user-1",
      "issue-pr",
      "run-1"
    ),
    { name: "ServiceError", code: "validation" }
  )
})

test("requestAutomaticPrPublish is idempotent for a duplicate or host-restart retry", async () => {
  const db = new EventLogDb()
  db.issues.push(automaticPrIssueRow())
  const supabase = new EventLogSupabase(db)

  const first = await requestAutomaticPrPublish(
    supabase as never,
    "user-1",
    "issue-pr",
    "run-1"
  )
  const second = await requestAutomaticPrPublish(
    supabase as never,
    "user-1",
    "issue-pr",
    "run-1"
  )

  assert.equal(first.created, true)
  assert.equal(second.created, false)
  assert.equal(second.requestId, first.requestId)
  assert.equal(second.messageId, first.messageId)
  assert.equal(db.issue_automatic_pr_requests.length, 1)
  assert.equal(db.messages.length, 1)
})

// `Promise.all` here interleaves the two calls at the same `await` points
// the real code hits (ownership check, issue read, RPC), exercising the
// dedup logic's outcome under either call order. It's a single-threaded
// JS simulation, not a substitute for the real DB-level guarantee — that
// atomicity comes from the `request_automatic_pr_publish` RPC's
// unique-constraint-backed `on conflict do nothing` insert (see the
// migration and `supabase/tests/automatic_pr_publish_rpc_test.sql`).
test("requestAutomaticPrPublish only creates one message under concurrent calls for the same run", async () => {
  const db = new EventLogDb()
  db.issues.push(automaticPrIssueRow())
  const supabase = new EventLogSupabase(db)

  const [first, second] = await Promise.all([
    requestAutomaticPrPublish(supabase as never, "user-1", "issue-pr", "run-1"),
    requestAutomaticPrPublish(supabase as never, "user-1", "issue-pr", "run-1"),
  ])

  const createdCount = [first, second].filter((r) => r.created).length
  assert.equal(createdCount, 1)
  assert.equal(first.messageId, second.messageId)
  assert.equal(db.messages.length, 1)
})

test("requestAutomaticPrPublish preserves create_pr_automatically for auditing after an automatic attempt", async () => {
  const db = new EventLogDb()
  db.issues.push(automaticPrIssueRow())
  const supabase = new EventLogSupabase(db)

  await requestAutomaticPrPublish(
    supabase as never,
    "user-1",
    "issue-pr",
    "run-1"
  )

  assert.equal(db.issues[0]?.create_pr_automatically, true)
})

test("a later active run can request automatic PR publishing again once no PR exists and changes remain", async () => {
  const db = new EventLogDb()
  db.issues.push(automaticPrIssueRow())
  const supabase = new EventLogSupabase(db)

  const first = await requestAutomaticPrPublish(
    supabase as never,
    "user-1",
    "issue-pr",
    "run-1"
  )

  // The prior run finished without a PR; a re-claim starts a new run and
  // unpublished changes still remain.
  db.issues[0]!.active_run_id = "run-2"

  const second = await requestAutomaticPrPublish(
    supabase as never,
    "user-1",
    "issue-pr",
    "run-2"
  )

  assert.equal(first.created, true)
  assert.equal(second.created, true)
  assert.notEqual(second.requestId, first.requestId)
  assert.equal(db.issue_automatic_pr_requests.length, 2)
})

// A reset wipes the transcript, but nothing stops the host that owns the
// active run — it keeps broadcasting into the issue's realtime channel long
// after its writes start getting refused. Naming the run it discarded is what
// lets the open tab ignore those late events instead of rebuilding the
// conversation the user just deleted.
test("resetIssueAgent reports the run it discarded", async () => {
  const db = new EventLogDb()
  db.issues.push(
    issueRow({
      id: "issue-reset",
      status: "in-progress",
      active_run_id: "run-1",
      active_host_id: "host-1",
    })
  )
  db.messages.push({
    id: "assistant-1",
    issue_id: "issue-reset",
    role: "assistant",
    content: "Half-finished thought",
    created_at: "2026-08-20T10:00:00.000Z",
  })
  const supabase = new EventLogSupabase(db)

  const reset = await resetIssueAgent(
    supabase as never,
    "user-1",
    "issue-reset",
    "claude_code",
    "claude-opus-5"
  )

  assert.deepEqual(reset.discardedRunIds, ["run-1"])
  assert.equal(reset.message.author_type, "gentic")
  assert.deepEqual(
    db.messages.map((message) => message.id),
    ["kickoff-message"]
  )
  assert.equal(db.issues[0]?.active_run_id, null)
})

// With no run in flight there is nothing broadcasting, so an empty list keeps
// the chat from blocking the run that is about to start.
test("resetIssueAgent discards nothing when no run is active", async () => {
  const db = new EventLogDb()
  db.issues.push(
    issueRow({ id: "issue-idle", status: "run-failed", active_run_id: null })
  )
  const supabase = new EventLogSupabase(db)

  const reset = await resetIssueAgent(
    supabase as never,
    "user-1",
    "issue-idle",
    "claude_code",
    null
  )

  assert.deepEqual(reset.discardedRunIds, [])
})
