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
  type: "feature" | "bug" | "spec"
  priority: IssuePriority
  updated_at: string
  usage_limit_reset_at: string | null
  active_run_id: string | null
  active_worker_id: string | null
  run_started_at: string | null
  run_error: string | null
  run_finished_at: string | null
  body: string | null
  number: number
  title: string | null
  agent_provider: "codex" | "claude_code"
  issue_model: string | null
  session_id: string | null
  issue_pull_requests: Array<{ url: string; created_at: string }>
  project_user_id: string
  project_key: string
  repo: string | null
  setup_script: string | null
  blockerStatuses: Array<"todo" | "held" | "in-progress" | "completed" | "cancelled">
}

type FakeWorker = {
  id: string
  user_id: string
  display_name: string
  setup_state: "enrolling" | "ready" | "setup_failed"
  banned_at: string | null
  created_at: string
  updated_at: string
  last_seen_at: string | null
  process_started_at: string | null
  gentic_version: string | null
  os: string | null
  arch: string | null
  configured_capacity: number
  provider_capabilities: {
    providers: {
      codex?: {
        enabled: boolean
        available: boolean
        authenticated: boolean | null
        version: string | null
      }
      claude_code?: {
        enabled: boolean
        available: boolean
        authenticated: boolean | null
        version: string | null
      }
    }
  }
}

const PRIORITY_RANK: Record<IssuePriority, number> = {
  low: 0,
  medium: 1,
  high: 2,
  urgent: 3,
}
const workerId = "worker-1"
const claudeWorkerId = "worker-2"

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
    agentProviders?: string[]
    activeWorkerIds?: string[]
    activeRunIdIsNull?: boolean
    excludedType?: string
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

  neq(column: string, value: unknown) {
    if (column === "type") {
      this.filters.excludedType = String(value)
    }
    return this
  }

  in(column: string, values: unknown[]) {
    if (column === "agent_provider") {
      this.filters.agentProviders = values.map(String)
    } else if (column === "active_worker_id") {
      this.filters.activeWorkerIds = values.map(String)
    }
    return this
  }

  not() {
    return this
  }

  returns<T>() {
    const data = this.matchingIssues()
      .filter(
        (issue) =>
          issue.active_worker_id &&
          !["completed", "cancelled"].includes(issue.status)
      )
      .map((issue) => ({ active_worker_id: issue.active_worker_id }))
    return Promise.resolve({ data: data as T, error: null })
  }

  is(column: string, value: unknown) {
    if (column === "unfinished_blockers" && value === null) {
      this.filters.requireNoUnfinishedBlockers = true
    } else if (column === "active_run_id" && value === null) {
      this.filters.activeRunIdIsNull = true
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
        this.filters.agentProviders &&
        !this.filters.agentProviders.includes(issue.agent_provider)
      ) {
        return false
      }
      if (
        this.filters.activeWorkerIds &&
        (!issue.active_worker_id ||
          !this.filters.activeWorkerIds.includes(issue.active_worker_id))
      ) {
        return false
      }
      if (this.filters.activeRunIdIsNull && issue.active_run_id !== null) {
        return false
      }
      if (this.filters.excludedType === issue.type) {
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

class FakeWorkersQuery {
  private readonly filters: {
    id?: string
    userId?: string
  } = {}

  constructor(private readonly db: FakeSupabase) {}

  select() {
    return this
  }

  eq(column: string, value: unknown) {
    if (column === "id") {
      this.filters.id = String(value)
    } else if (column === "user_id") {
      this.filters.userId = String(value)
    }
    return this
  }

  maybeSingle() {
    const worker =
      this.db.workers.find((entry) => {
        if (this.filters.id && entry.id !== this.filters.id) return false
        if (this.filters.userId && entry.user_id !== this.filters.userId) {
          return false
        }
        return true
      }) ?? null

    return {
      returns<T>() {
        return Promise.resolve({ data: worker as T, error: null })
      },
    }
  }
}

class FakeSupabase {
  readonly inserts: Record<string, unknown>[] = []
  readonly issueQueries: FakeIssuesQuery[] = []
  beforeIssueUpdate: (() => void) | null = null

  constructor(
    readonly pendingMessages: Record<string, unknown>[] = [],
    readonly issues: FakeIssue[] = [],
    readonly workers: FakeWorker[] = [worker()]
  ) {}

  from(table: string) {
    if (table === "issues") {
      return new FakeIssuesQuery(this)
    }
    if (table === "workers") {
      return new FakeWorkersQuery(this)
    }
    assert.equal(table, "messages")
    return new FakeMessagesQuery(this)
  }
}

function worker(overrides: Partial<FakeWorker> = {}): FakeWorker {
  return {
    id: workerId,
    user_id: "user-1",
    display_name: "Worker",
    setup_state: "ready",
    banned_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    last_seen_at: new Date().toISOString(),
    process_started_at: "2026-07-01T00:00:00.000Z",
    gentic_version: "0.15.0",
    os: "linux",
    arch: "x64",
    configured_capacity: 1,
    provider_capabilities: {
      providers: {
        codex: {
          enabled: true,
          available: true,
          authenticated: true,
          version: "1.0.0",
        },
      },
    },
    ...overrides,
  }
}

function issue(overrides: Partial<FakeIssue> & Pick<FakeIssue, "id">): FakeIssue {
  const { id, ...rest } = overrides
  return {
    id,
    status: "todo",
    type: "feature",
    priority: "medium",
    updated_at: "2026-07-01T00:00:00.000Z",
    usage_limit_reset_at: null,
    active_run_id: null,
    active_worker_id: null,
    run_started_at: null,
    run_error: "previous error",
    run_finished_at: "2026-07-01T00:01:00.000Z",
    body: "Implement the task",
    number: 1,
    title: "Implement the task",
    agent_provider: "codex",
    issue_model: null,
    session_id: null,
    issue_pull_requests: [],
    project_user_id: "user-1",
    project_key: "ACME",
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
    number: issue.number,
    title: issue.title,
    agent_provider: issue.agent_provider,
    issue_model: issue.issue_model,
    session_id: issue.session_id,
    issue_pull_requests: issue.issue_pull_requests,
    body: issue.body,
    projects: {
      key: issue.project_key,
      repo: issue.repo,
      setup_script: issue.setup_script,
      user_id: issue.project_user_id,
    },
  }
}

test("claim backfills the Gentic-authored kickoff message for todo issues without pending user messages", async () => {
  const supabase = new FakeSupabase()

  await ensureTodoIssueHasPendingPrompt(supabase as never, "issue-1", "GEN-1")

  assert.deepEqual(supabase.inserts, [
    {
      issue_id: "issue-1",
      role: "user",
      author_type: "gentic",
      content: "Work on Gentic issue GEN-1.",
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

  await ensureTodoIssueHasPendingPrompt(supabase as never, "issue-1", "GEN-1")

  assert.deepEqual(supabase.inserts, [])
})

test("claim includes the issue code inputs and current title the worker needs", async () => {
  const supabase = new FakeSupabase([], [
    issue({
      id: "coded",
      project_key: "ACME",
      number: 42,
      title: "Fix the thing",
    }),
  ])

  const claimed = await claimNextQueuedIssue(supabase as never, "user-1", workerId)

  assert.equal(claimed?.code, "ACME-42")
  assert.equal(claimed?.title, "Fix the thing")
  assert.equal(claimed?.branchName, "acme-42-fix-the-thing")
})

test("claim does not expose associated pull request URLs", async () => {
  const supabase = new FakeSupabase([], [
    issue({
      id: "associated",
      issue_pull_requests: [
        {
          url: "https://github.com/acme/repo/pull/41",
          created_at: "2026-07-01T00:00:00.000Z",
        },
        {
          url: "https://github.com/acme/repo/pull/42",
          created_at: "2026-07-02T00:00:00.000Z",
        },
      ],
    }),
  ])

  const claimed = await claimNextQueuedIssue(supabase as never, "user-1", workerId)

  assert.equal("prUrl" in (claimed ?? {}), false)
  assert.equal(claimed?.branchName, "acme-1-implement-the-task")
})

test("claim skips spec issues and takes the next agent issue instead", async () => {
  const supabase = new FakeSupabase([], [
    issue({
      id: "spec-urgent",
      type: "spec",
      priority: "urgent",
      updated_at: "2026-07-01T00:00:00.000Z",
    }),
    issue({
      id: "feature-low",
      priority: "low",
      updated_at: "2026-07-02T00:00:00.000Z",
    }),
  ])

  const claimed = await claimNextQueuedIssue(supabase as never, "user-1", workerId)

  assert.equal(claimed?.id, "feature-low")
  assert.equal(
    supabase.issues.find((entry) => entry.id === "spec-urgent")?.active_worker_id,
    null
  )
})

test("claim leaves a spec issue in todo when it is the only eligible issue", async () => {
  const supabase = new FakeSupabase([], [issue({ id: "spec", type: "spec" })])

  const claimed = await claimNextQueuedIssue(supabase as never, "user-1", workerId)

  assert.equal(claimed, null)
  assert.equal(supabase.issues[0]?.status, "todo")
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

  const claimed = await claimNextQueuedIssue(supabase as never, "user-1", workerId)

  assert.equal(claimed?.id, "urgent-new")
  assert.equal(
    supabase.issues.find((entry) => entry.id === "urgent-new")?.active_worker_id,
    workerId
  )
  assert.deepEqual(supabase.issueQueries[0]?.orders, [
    { column: "priority", ascending: false },
    { column: "updated_at", ascending: true },
  ])
})

test("claim routes a shared queue by the authenticated worker's provider readiness", async () => {
  const supabase = new FakeSupabase(
    [],
    [
      issue({
        id: "claude-urgent",
        priority: "urgent",
        agent_provider: "claude_code",
      }),
      issue({
        id: "codex-low",
        priority: "low",
        agent_provider: "codex",
      }),
    ],
    [
      worker(),
      worker({
        id: claudeWorkerId,
        provider_capabilities: {
          providers: {
            claude_code: {
              enabled: true,
              available: true,
              authenticated: true,
              version: "1.0.0",
            },
          },
        },
      }),
    ]
  )

  const codexClaim = await claimNextQueuedIssue(
    supabase as never,
    "user-1",
    workerId
  )
  const claudeClaim = await claimNextQueuedIssue(
    supabase as never,
    "user-1",
    claudeWorkerId
  )

  assert.equal(codexClaim?.id, "codex-low")
  assert.equal(claudeClaim?.id, "claude-urgent")
  assert.equal(
    supabase.issues.find((entry) => entry.id === "codex-low")
      ?.active_worker_id,
    workerId
  )
  assert.equal(
    supabase.issues.find((entry) => entry.id === "claude-urgent")
      ?.active_worker_id,
    claudeWorkerId
  )
})

test("claim derives capacity from active issue assignments", async () => {
  const supabase = new FakeSupabase([], [
    issue({
      id: "already-running",
      status: "in-progress",
      active_worker_id: workerId,
      active_run_id: "already-running-run",
    }),
    issue({ id: "queued-work" }),
  ])

  const claimed = await claimNextQueuedIssue(supabase as never, "user-1", workerId)

  assert.equal(claimed, null)
  assert.equal(supabase.issues.find((entry) => entry.id === "queued-work")?.status, "todo")
})

test("unsupported workers cannot claim but update-available workers can", async () => {
  const unsupported = new FakeSupabase(
    [],
    [issue({ id: "unsupported-work" })],
    [worker({ gentic_version: "0.13.0" })]
  )
  const updateAvailable = new FakeSupabase(
    [],
    [issue({ id: "update-available-work" })],
    [worker({ gentic_version: "0.14.0" })]
  )

  assert.equal(
    await claimNextQueuedIssue(unsupported as never, "user-1", workerId, {
      compatibilityPolicy: {
        minimumSupportedVersion: "0.14.0",
        currentVersion: "0.15.0",
      },
    }),
    null
  )

  const claimed = await claimNextQueuedIssue(
    updateAvailable as never,
    "user-1",
    workerId,
    {
      compatibilityPolicy: {
        minimumSupportedVersion: "0.14.0",
        currentVersion: "0.15.0",
      },
    }
  )

  assert.equal(claimed?.id, "update-available-work")
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

  const claimed = await claimNextQueuedIssue(supabase as never, "user-1", workerId)

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

  const claimed = await claimNextQueuedIssue(supabase as never, "user-1", workerId)

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

  const claimed = await claimNextQueuedIssue(supabase as never, "user-1", workerId)

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

  const claimed = await claimNextQueuedIssue(supabase as never, "user-1", workerId)

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

  const claimed = await claimNextQueuedIssue(supabase as never, "user-1", workerId)

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

  const claimed = await claimNextQueuedIssue(supabase as never, "user-1", workerId)

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
