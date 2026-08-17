import assert from "node:assert/strict"
import test from "node:test"

import { requestIssueAutomaticPrPublish } from "../app/api/v1/agent/issues/[id]/automatic-pr-requests/route"

const runId1 = "11111111-1111-4111-8111-111111111111"
const runId2 = "22222222-2222-4222-8222-222222222222"
const workerId = "33333333-3333-4333-8333-333333333333"

type IssueRow = {
  id: string
  project_user_id: string
  active_worker_id: string | null
  project_key: string
  active_run_id: string | null
  create_pr_automatically: boolean
  has_unpublished_agent_changes: boolean
  issue_pull_requests: Array<{ id: string }>
  number: number
  title: string | null
}

type WorkerRow = {
  id: string
  user_id: string
  banned_at: string | null
  last_seen_at: string | null
}

type RpcRequest = { requestId: string; messageId: string; status: string }

class FakeIssuesQuery {
  private filters: Record<string, unknown> = {}
  private selectingOwnership = false

  constructor(private readonly db: FakeSupabase) {}

  select(columns: string) {
    this.selectingOwnership = columns.includes("projects!inner(user_id)")
    return this
  }

  eq(column: string, value: unknown) {
    this.filters[column] = value
    return this
  }

  maybeSingle() {
    const row = this.db.issues.find((issue) => this.matches(issue))
    if (!row) {
      return Promise.resolve({ data: null, error: null })
    }
    if (this.selectingOwnership) {
      return Promise.resolve({
        data: {
          id: row.id,
          active_worker_id: row.active_worker_id,
          active_run_id: row.active_run_id,
          projects: { user_id: row.project_user_id },
        },
        error: null,
      })
    }
    return Promise.resolve({
      data: {
        id: row.id,
        number: row.number,
        title: row.title,
        active_run_id: row.active_run_id,
        create_pr_automatically: row.create_pr_automatically,
        has_unpublished_agent_changes: row.has_unpublished_agent_changes,
        issue_pull_requests: row.issue_pull_requests,
        projects: { key: row.project_key },
      },
      error: null,
    })
  }

  private matches(row: IssueRow): boolean {
    return Object.entries(this.filters).every(([column, value]) => {
      if (column === "id") return row.id === value
      if (column === "projects.user_id") return row.project_user_id === value
      return true
    })
  }
}

class FakeWorkersQuery {
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
    const row = this.db.workers.find((worker) =>
      Object.entries(this.filters).every(([column, value]) => {
        if (column === "id") return worker.id === value
        if (column === "user_id") return worker.user_id === value
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

// Mirrors the `request_automatic_pr_publish` RPC's dedup semantics: the first
// call for a given (issue, run) pair "creates" the request, every later call
// — concurrent or a retried/restarted worker — gets back the same ids with
// `created: false`, matching the DB's `on conflict do nothing` + fallback
// `select`.
class FakeSupabase {
  readonly rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
  private readonly requests = new Map<string, RpcRequest>()
  private nextId = 1

  constructor(
    readonly issues: IssueRow[],
    readonly workers: WorkerRow[] = [
      {
        id: workerId,
        user_id: "user-1",
        banned_at: null,
        last_seen_at: new Date().toISOString(),
      },
    ]
  ) {}

  from(table: string) {
    if (table === "workers") {
      return new FakeWorkersQuery(this)
    }
    assert.equal(table, "issues")
    return new FakeIssuesQuery(this)
  }

  rpc(name: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ name, args })
    const key = `${args.p_issue_id}:${args.p_run_id}`
    let created = false
    let request = this.requests.get(key)
    if (!request) {
      request = {
        requestId: `request-${this.nextId}`,
        messageId: `message-${this.nextId}`,
        status: "pending",
      }
      this.nextId += 1
      this.requests.set(key, request)
      created = true
    }
    return {
      single: <T>() =>
        Promise.resolve({
          data: {
            request_id: request!.requestId,
            message_id: request!.messageId,
            status: request!.status,
            created,
          } as T,
          error: null,
        }),
    }
  }
}

function issue(overrides: Partial<IssueRow> & Pick<IssueRow, "id">): IssueRow {
  return {
    project_user_id: "user-1",
    active_worker_id: workerId,
    project_key: "ACME",
    active_run_id: runId1,
    create_pr_automatically: true,
    has_unpublished_agent_changes: true,
    issue_pull_requests: [],
    number: 7,
    title: "Fix the thing",
    ...overrides,
  }
}

test("rejects a malformed body before touching supabase", async () => {
  const supabase = new FakeSupabase([issue({ id: "issue-1" })])

  await assert.rejects(
    requestIssueAutomaticPrPublish(
      supabase as never,
      "user-1",
      workerId,
      "issue-1",
      {}
    ),
    { name: "ZodError" }
  )
})

test("rejects when the issue does not belong to the caller", async () => {
  const supabase = new FakeSupabase([
    issue({ id: "issue-1", project_user_id: "someone-else" }),
  ])

  await assert.rejects(
    requestIssueAutomaticPrPublish(
      supabase as never,
      "user-1",
      workerId,
      "issue-1",
      {
        active_run_id: runId1,
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
    requestIssueAutomaticPrPublish(
      supabase as never,
      "user-1",
      workerId,
      "issue-1",
      {
        active_run_id: runId2,
      }
    ),
    { status: 409, message: "Run is not active for this worker" }
  )
  assert.deepEqual(supabase.rpcCalls, [])
})

test("rejects when create_pr_automatically is not opted in", async () => {
  const supabase = new FakeSupabase([
    issue({ id: "issue-1", create_pr_automatically: false }),
  ])

  await assert.rejects(
    requestIssueAutomaticPrPublish(
      supabase as never,
      "user-1",
      workerId,
      "issue-1",
      {
        active_run_id: runId1,
      }
    ),
    { name: "ServiceError", code: "validation" }
  )
})

test("rejects when the issue already has a pull request", async () => {
  const supabase = new FakeSupabase([
    issue({ id: "issue-1", issue_pull_requests: [{ id: "pr-9" }] }),
  ])

  await assert.rejects(
    requestIssueAutomaticPrPublish(
      supabase as never,
      "user-1",
      workerId,
      "issue-1",
      {
        active_run_id: runId1,
      }
    ),
    { name: "ServiceError", code: "validation" }
  )
})

test("rejects when a webhook-owned Associated Pull Request already exists", async () => {
  const supabase = new FakeSupabase([
    issue({ id: "issue-1", issue_pull_requests: [{ id: "associated-pr-1" }] }),
  ])

  await assert.rejects(
    requestIssueAutomaticPrPublish(
      supabase as never,
      "user-1",
      workerId,
      "issue-1",
      { active_run_id: runId1 }
    ),
    { name: "ServiceError", code: "validation" }
  )
  assert.deepEqual(supabase.rpcCalls, [])
})

test("rejects when there are no unpublished changes", async () => {
  const supabase = new FakeSupabase([
    issue({ id: "issue-1", has_unpublished_agent_changes: false }),
  ])

  await assert.rejects(
    requestIssueAutomaticPrPublish(
      supabase as never,
      "user-1",
      workerId,
      "issue-1",
      {
        active_run_id: runId1,
      }
    ),
    { name: "ServiceError", code: "validation" }
  )
})

test("creates the automatic PR request and returns session-continuation context", async () => {
  const supabase = new FakeSupabase([issue({ id: "issue-1" })])

  const result = await requestIssueAutomaticPrPublish(
    supabase as never,
    "user-1",
    workerId,
    "issue-1",
    { active_run_id: runId1 }
  )

  assert.equal(result.created, true)
  assert.equal(result.status, "pending")
  assert.deepEqual(result.issue, {
    id: "issue-1",
    code: "ACME-7",
    title: "Fix the thing",
    activeRunId: runId1,
    createPrAutomatically: true,
    hasUnpublishedAgentChanges: true,
  })
  assert.equal(supabase.rpcCalls[0]?.name, "request_automatic_pr_publish")
  assert.equal(supabase.rpcCalls[0]?.args.p_issue_id, "issue-1")
  assert.equal(supabase.rpcCalls[0]?.args.p_run_id, runId1)
  const publishingMessage = String(supabase.rpcCalls[0]?.args.p_content)
  assert.match(publishingMessage, /`acme-7-fix-the-thing` branch/)
  assert.match(publishingMessage, /never create an empty commit/i)
  assert.match(publishingMessage, /summary section and a test plan section/i)

  // create_pr_automatically stays true after the automatic attempt so it
  // keeps auditing the user's opt-in, rather than being consumed/cleared.
  assert.equal(supabase.issues[0]?.create_pr_automatically, true)
})

test("a duplicate/retried call for the same run is idempotent, not a second message", async () => {
  const supabase = new FakeSupabase([issue({ id: "issue-1" })])

  const first = await requestIssueAutomaticPrPublish(
    supabase as never,
    "user-1",
    workerId,
    "issue-1",
    { active_run_id: runId1 }
  )
  const second = await requestIssueAutomaticPrPublish(
    supabase as never,
    "user-1",
    workerId,
    "issue-1",
    { active_run_id: runId1 }
  )

  assert.equal(first.created, true)
  assert.equal(second.created, false)
  assert.equal(second.requestId, first.requestId)
  assert.equal(second.messageId, first.messageId)
  assert.equal(supabase.rpcCalls.length, 2)
})

// `FakeSupabase.rpc` resolves synchronously, so `Promise.all` here can't
// interleave the two calls the way real concurrent Postgres transactions
// would — this only proves the fake's own Map-based dedup is consistent
// under either call order, not the real DB-level guarantee. That guarantee
// comes from the `request_automatic_pr_publish` RPC's unique-constraint-
// backed insert (see the migration and
// supabase/tests/automatic_pr_publish_rpc_test.sql).
test("concurrent calls for the same run only create one message", async () => {
  const supabase = new FakeSupabase([issue({ id: "issue-1" })])

  const [first, second] = await Promise.all([
    requestIssueAutomaticPrPublish(
      supabase as never,
      "user-1",
      workerId,
      "issue-1",
      {
        active_run_id: runId1,
      }
    ),
    requestIssueAutomaticPrPublish(
      supabase as never,
      "user-1",
      workerId,
      "issue-1",
      {
        active_run_id: runId1,
      }
    ),
  ])

  const createdCount = [first, second].filter((r) => r.created).length
  assert.equal(createdCount, 1)
  assert.equal(first.messageId, second.messageId)
})

test("a later active run may create another request once the previous one is set", async () => {
  const supabase = new FakeSupabase([issue({ id: "issue-1" })])

  const first = await requestIssueAutomaticPrPublish(
    supabase as never,
    "user-1",
    workerId,
    "issue-1",
    { active_run_id: runId1 }
  )

  // Simulate a reclaim into a new active run, e.g. after the first run
  // finished without opening a PR and unpublished changes remain.
  supabase.issues[0]!.active_run_id = runId2

  const second = await requestIssueAutomaticPrPublish(
    supabase as never,
    "user-1",
    workerId,
    "issue-1",
    { active_run_id: runId2 }
  )

  assert.equal(first.created, true)
  assert.equal(second.created, true)
  assert.notEqual(second.requestId, first.requestId)
  assert.notEqual(second.messageId, first.messageId)
})
