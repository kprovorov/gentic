import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  claimNextQueuedIssue,
  ensureTodoIssueHasPendingPrompt,
} from "../app/api/v1/agent/issues/claim/route"

type IssuePriority = "low" | "medium" | "high" | "urgent"

type FakeIssue = {
  id: string
  status:
    | "draft"
    | "todo"
    | "held"
    | "queued"
    | "in-progress"
    | "completed"
    | "cancelled"
  priority: IssuePriority
  updated_at: string
  usage_limit_reset_at: string | null
  active_run_id: string | null
  run_started_at: string | null
  run_error: string | null
  run_finished_at: string | null
  prompt: string | null
  agent_provider: "codex" | "claude"
  issue_model: string | null
  session_id: string | null
  pr_url: string | null
  project_user_id: string
  repo: string | null
  setup_script: string | null
  blockerStatuses: Array<"todo" | "held" | "in-progress" | "completed" | "cancelled">
}

const PRIORITY_RANK: Record<IssuePriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  urgent: 3,
}

class FakeMessagesQuery {
  private insertValues: Record<string, unknown> | null = null
  private readonly filters: Record<string, unknown> = {}

  constructor(private readonly db: FakeSupabase) {}

  select() {
    return this
  }

  insert(values: Record<string, unknown>) {
    this.insertValues = values
    this.db.inserts.push(values)
    return Promise.resolve({ data: null, error: null })
  }

  eq(column: string, value: unknown) {
    this.filters[column] = value
    return this
  }

  is(column: string, value: unknown) {
    this.filters[column] = value
    return this
  }

  limit() {
    if (this.insertValues) {
      return Promise.resolve({ data: null, error: null })
    }

    const data = this.db.pendingMessages.filter((message) =>
      Object.entries(this.filters).every(
        ([column, value]) => message[column] === value
      )
    )
    return Promise.resolve({ data, error: null })
  }
}

class FakeIssuesQuery {
  readonly orders: { column: string; ascending: boolean }[] = []
  private readonly filters: {
    id?: string
    userId?: string
    eligibleAt?: string
    requireNoUnfinishedBlockers?: boolean
  } = {}
  private updateValues: Partial<FakeIssue> | null = null
  private limitCount: number | null = null

  constructor(private readonly db: FakeSupabase) {}

  select() {
    return this
  }

  update(values: Partial<FakeIssue>) {
    this.updateValues = values
    return this
  }

  or(filter: string) {
    const match = filter.match(/usage_limit_reset_at\.lte\.(.+)\)$/)
    if (!filter.startsWith("status.eq.todo,and(status.eq.held,") || !match) {
      throw new Error(`Unexpected issue eligibility filter: ${filter}`)
    }
    this.filters.eligibleAt = match[1]
    return this
  }

  eq(column: string, value: unknown) {
    if (column === "id") {
      this.filters.id = String(value)
    } else if (column === "projects.user_id") {
      this.filters.userId = String(value)
    }
    return this
  }

  not() {
    return this
  }

  is(column: string, value: unknown) {
    if (column === "unfinished_blockers" && value === null) {
      this.filters.requireNoUnfinishedBlockers = true
    }
    return this
  }

  order(column: string, options: { ascending?: boolean }) {
    this.orders.push({ column, ascending: options.ascending ?? true })
    return this
  }

  limit(count: number) {
    this.limitCount = count
    return this
  }

  maybeSingle() {
    return this.updateValues ? this.updateMaybeSingle() : this.selectMaybeSingle()
  }

  private selectMaybeSingle() {
    this.db.issueQueries.push(this)
    const issue = this.matchingIssues()
      .sort(compareIssues(this.orders))
      .slice(0, this.limitCount ?? undefined)[0]

    return Promise.resolve({
      data: issue ? toClaimCandidate(issue) : null,
      error: null,
    })
  }

  private updateMaybeSingle() {
    this.db.beforeIssueUpdate?.()
    const issue = this.matchingIssues()[0]
    if (!issue) {
      return Promise.resolve({ data: null, error: null })
    }

    Object.assign(issue, this.updateValues)
    return Promise.resolve({ data: { id: issue.id }, error: null })
  }

  private matchingIssues() {
    return this.db.issues.filter((issue) => {
      if (this.filters.id && issue.id !== this.filters.id) return false
      if (this.filters.userId && issue.project_user_id !== this.filters.userId) {
        return false
      }
      if (
        this.filters.requireNoUnfinishedBlockers &&
        issue.blockerStatuses.some(
          (status) => status !== "completed" && status !== "cancelled"
        )
      ) {
        return false
      }
      if (!this.filters.eligibleAt) return true
      return isEligible(issue, this.filters.eligibleAt)
    })
  }
}

class FakeSupabase {
  readonly inserts: Record<string, unknown>[] = []
  readonly issueQueries: FakeIssuesQuery[] = []
  beforeIssueUpdate: (() => void) | null = null

  constructor(
    readonly pendingMessages: Record<string, unknown>[] = [],
    readonly issues: FakeIssue[] = []
  ) {}

  from(table: string) {
    if (table === "issues") {
      return new FakeIssuesQuery(this)
    }
    assert.equal(table, "messages")
    return new FakeMessagesQuery(this)
  }
}

function issue(overrides: Partial<FakeIssue> & Pick<FakeIssue, "id">): FakeIssue {
  const { id, ...rest } = overrides
  return {
    id,
    status: "todo",
    priority: "medium",
    updated_at: "2026-07-01T00:00:00.000Z",
    usage_limit_reset_at: null,
    active_run_id: null,
    run_started_at: null,
    run_error: "previous error",
    run_finished_at: "2026-07-01T00:01:00.000Z",
    prompt: "Implement the task",
    agent_provider: "codex",
    issue_model: null,
    session_id: null,
    pr_url: null,
    project_user_id: "user-1",
    repo: "acme/repo",
    setup_script: null,
    blockerStatuses: [],
    ...rest,
  }
}

function isEligible(issue: FakeIssue, now: string): boolean {
  return (
    issue.status === "todo" ||
    (issue.status === "held" &&
      issue.usage_limit_reset_at !== null &&
      issue.usage_limit_reset_at <= now)
  )
}

function compareIssues(orders: { column: string; ascending: boolean }[]) {
  return (left: FakeIssue, right: FakeIssue): number => {
    for (const order of orders) {
      let comparison = 0
      if (order.column === "priority") {
        comparison = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority]
      } else if (order.column === "updated_at") {
        comparison = left.updated_at.localeCompare(right.updated_at)
      }
      if (comparison !== 0) {
        return order.ascending ? comparison : -comparison
      }
    }
    return 0
  }
}

function toClaimCandidate(issue: FakeIssue) {
  return {
    id: issue.id,
    status: issue.status,
    agent_provider: issue.agent_provider,
    issue_model: issue.issue_model,
    session_id: issue.session_id,
    pr_url: issue.pr_url,
    prompt: issue.prompt,
    projects: {
      repo: issue.repo,
      setup_script: issue.setup_script,
      user_id: issue.project_user_id,
    },
  }
}

test("claim backfills a prompt for todo issues without pending user messages", async () => {
  const supabase = new FakeSupabase()

  await ensureTodoIssueHasPendingPrompt(
    supabase as never,
    "issue-1",
    "Implement the task"
  )

  assert.deepEqual(supabase.inserts, [
    {
      issue_id: "issue-1",
      role: "user",
      content: "Implement the task",
    },
  ])
})

test("claim keeps existing pending user messages intact", async () => {
  const supabase = new FakeSupabase([
    {
      id: "message-1",
      issue_id: "issue-1",
      role: "user",
      consumed_by_run_id: null,
    },
  ])

  await ensureTodoIssueHasPendingPrompt(
    supabase as never,
    "issue-1",
    "Implement the task"
  )

  assert.deepEqual(supabase.inserts, [])
})

test("claim picks urgent before older lower-priority todo issues", async () => {
  const supabase = new FakeSupabase([], [
    issue({
      id: "low-old",
      priority: "low",
      updated_at: "2026-07-01T00:00:00.000Z",
    }),
    issue({
      id: "urgent-new",
      priority: "urgent",
      updated_at: "2026-07-02T00:00:00.000Z",
    }),
  ])

  const claimed = await claimNextQueuedIssue(supabase as never, "user-1")

  assert.equal(claimed?.id, "urgent-new")
  assert.deepEqual(supabase.issueQueries[0]?.orders, [
    { column: "priority", ascending: false },
    { column: "updated_at", ascending: true },
  ])
})

test("claim breaks equal-priority ties FIFO by oldest eligible issue", async () => {
  const supabase = new FakeSupabase([], [
    issue({
      id: "newer",
      priority: "high",
      updated_at: "2026-07-02T00:00:00.000Z",
    }),
    issue({
      id: "older",
      priority: "high",
      updated_at: "2026-07-01T00:00:00.000Z",
    }),
  ])

  const claimed = await claimNextQueuedIssue(supabase as never, "user-1")

  assert.equal(claimed?.id, "older")
})

test("claim preserves blocker checks before applying priority", async () => {
  const supabase = new FakeSupabase([], [
    issue({
      id: "blocked-urgent",
      priority: "urgent",
      blockerStatuses: ["in-progress"],
    }),
    issue({
      id: "completed-blocker-high",
      priority: "high",
      blockerStatuses: ["completed"],
    }),
    issue({ id: "unblocked-low", priority: "low" }),
  ])

  const claimed = await claimNextQueuedIssue(supabase as never, "user-1")

  assert.equal(claimed?.id, "completed-blocker-high")
  assert.equal(
    supabase.issues.find((entry) => entry.id === "blocked-urgent")?.status,
    "todo"
  )
})

test("claim includes reset-ready held issues by priority but skips future holds", async () => {
  const supabase = new FakeSupabase([], [
    issue({
      id: "future-held",
      status: "held",
      priority: "urgent",
      usage_limit_reset_at: "2999-01-01T00:00:00.000Z",
    }),
    issue({
      id: "ready-held",
      status: "held",
      priority: "high",
      usage_limit_reset_at: "2026-01-01T00:00:00.000Z",
    }),
    issue({ id: "todo-low", priority: "low" }),
  ])

  const claimed = await claimNextQueuedIssue(supabase as never, "user-1")

  assert.equal(claimed?.id, "ready-held")
  assert.equal(supabase.inserts.length, 0)
  const readyHeld = supabase.issues.find((entry) => entry.id === "ready-held")
  assert.equal(readyHeld?.status, "queued")
  assert.equal(readyHeld?.usage_limit_reset_at, null)
})

test("claim does not start drafts or preempt active runs", async () => {
  const supabase = new FakeSupabase([], [
    issue({ id: "draft-urgent", status: "draft", priority: "urgent" }),
    issue({
      id: "queued-urgent",
      status: "queued",
      priority: "urgent",
      active_run_id: "active-queued",
    }),
    issue({
      id: "in-progress-high",
      status: "in-progress",
      priority: "high",
      active_run_id: "active-progress",
    }),
    issue({ id: "todo-low", status: "todo", priority: "low" }),
  ])

  const claimed = await claimNextQueuedIssue(supabase as never, "user-1")

  assert.equal(claimed?.id, "todo-low")
  assert.equal(
    supabase.issues.find((entry) => entry.id === "draft-urgent")?.status,
    "draft"
  )
  assert.equal(
    supabase.issues.find((entry) => entry.id === "queued-urgent")?.active_run_id,
    "active-queued"
  )
  assert.equal(
    supabase.issues.find((entry) => entry.id === "in-progress-high")
      ?.active_run_id,
    "active-progress"
  )
})

test("claim returns null when another worker wins the conditional update", async () => {
  const supabase = new FakeSupabase([], [issue({ id: "race-winner" })])
  supabase.beforeIssueUpdate = () => {
    supabase.issues[0]!.status = "queued"
  }

  const claimed = await claimNextQueuedIssue(supabase as never, "user-1")

  assert.equal(claimed, null)
  assert.equal(supabase.issues[0]?.active_run_id, null)
})

test("claim returns null when a held issue becomes reset-ineligible before update", async () => {
  const supabase = new FakeSupabase([], [
    issue({
      id: "delayed-held",
      status: "held",
      priority: "urgent",
      usage_limit_reset_at: "2026-01-01T00:00:00.000Z",
    }),
  ])
  supabase.beforeIssueUpdate = () => {
    supabase.issues[0]!.usage_limit_reset_at = "2999-01-01T00:00:00.000Z"
  }

  const claimed = await claimNextQueuedIssue(supabase as never, "user-1")

  assert.equal(claimed, null)
  assert.equal(supabase.issues[0]?.status, "held")
  assert.equal(supabase.issues[0]?.active_run_id, null)
})

test("worker selection index update is in a forward migration", async () => {
  const appliedMigration = await readFile(
    new URL(
      "../../../supabase/migrations/20260729072347_add_issue_priorities.sql",
      import.meta.url
    ),
    "utf8"
  )
  const forwardMigration = await readFile(
    new URL(
      "../../../supabase/migrations/20260729101749_optimize_worker_claim_priority_index.sql",
      import.meta.url
    ),
    "utf8"
  )

  assert.match(
    appliedMigration,
    /create index issues_worker_selection_priority_idx\s+on public\.issues\(status, usage_limit_reset_at, priority desc, updated_at asc\)\s+where status in \('todo', 'held'\);/
  )

  assert.match(
    forwardMigration,
    /drop index if exists public\.issues_worker_selection_priority_idx;\s+create index issues_worker_selection_priority_idx\s+on public\.issues\(priority desc, updated_at asc\)\s+where status in \('todo', 'held'\);/
  )
  assert.match(
    forwardMigration,
    /create index issues_worker_selection_priority_idx\s+on public\.issues\(priority desc, updated_at asc\)\s+where status in \('todo', 'held'\);/
  )
})
