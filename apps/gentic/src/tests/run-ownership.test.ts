import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { resolve } from "node:path"

import { createAgentApi } from "../api.js"

const ISSUE_ID = "11111111-1111-4111-8111-111111111111"
const RUN_ID = "22222222-2222-4222-8222-222222222222"

test("worker API sends run ownership on heartbeat, state transitions, and message writes", async () => {
  const requests: Array<{ path: string; body: unknown }> = []
  const restoreFetch = stubFetch(async (url, init) => {
    requests.push({
      path: new URL(url).pathname,
      body: init.body ? JSON.parse(String(init.body)) : null,
    })
    return jsonResponse({ ok: true, id: "33333333-3333-4333-8333-333333333333" })
  })

  try {
    const api = createAgentApi({
      apiUrl: "https://gentic.example/api/v1",
      apiKey: "secret",
    })

    await api.heartbeatRun(ISSUE_ID, RUN_ID)
    await api.setRunState(ISSUE_ID, RUN_ID, {
      status: "ready-for-review",
      run_finished_at: "2026-07-14T12:00:00.000Z",
    })
    await api.insertMessage(ISSUE_ID, {
      id: "33333333-3333-4333-8333-333333333333",
      run_id: RUN_ID,
      role: "assistant",
      content: "done",
    })
  } finally {
    restoreFetch()
  }

  assert.deepEqual(
    requests.map((request) => request.body),
    [
      { active_run_id: RUN_ID },
      {
        active_run_id: RUN_ID,
        status: "ready-for-review",
        run_finished_at: "2026-07-14T12:00:00.000Z",
      },
      {
        run_id: RUN_ID,
        id: "33333333-3333-4333-8333-333333333333",
        role: "assistant",
        content: "done",
      },
    ]
  )
})

test("run ownership migration guards overlapping claims and stale writes", () => {
  const sql = migrationSql()

  assert.match(sql, /create table public\.issue_runs/)
  assert.match(sql, /create table public\.issue_runs/)
  assert.match(
    sql,
    /create or replace function public\.patch_issue_run_state\(\s*p_issue_id uuid,\s*p_run_id uuid,\s*p_fields jsonb\s*\)/
  )
  assert.match(sql, /for update of i skip locked/)
  assert.match(
    sql,
    /active_run\.status = 'active'\s+and active_run\.lease_expires_at > v_now/
  )
  assert.match(sql, /i\.active_run_id = r\.id/)
  assert.match(sql, /public\.touch_issue_run\(p_issue_id, p_run_id\)/)
  assert.match(sql, /raise exception 'run is no longer active'/)
  assert.match(sql, /where id = p_issue_id\s+and active_run_id = p_run_id/)
})

test("run ownership migration atomically invalidates active runs during reset", () => {
  const sql = migrationSql()
  const resetStart = sql.indexOf("create or replace function public.reset_issue_run")
  assert.notEqual(resetStart, -1)
  const resetSql = sql.slice(resetStart)

  const supersedeIndex = resetSql.indexOf("update public.issue_runs")
  const deleteMessagesIndex = resetSql.indexOf("delete from public.messages")
  const todoIndex = resetSql.indexOf("set status = 'todo'")
  const kickoffIndex = resetSql.indexOf("insert into public.messages")

  assert.ok(supersedeIndex >= 0)
  assert.ok(deleteMessagesIndex > supersedeIndex)
  assert.ok(todoIndex > deleteMessagesIndex)
  assert.ok(kickoffIndex > todoIndex)
  assert.match(resetSql, /where issue_id = p_issue_id\s+and status = 'active'/)
  assert.match(resetSql, /active_run_id = null/)
})

test("overlapping workers cannot both claim or write assistant messages", () => {
  const store = new RunOwnershipStore()
  const first = store.claim()

  assert.ok(first)
  assert.equal(store.claim(), null)
  assert.equal(store.insertAssistantMessage(first.runId, "first message"), true)
  assert.deepEqual(store.assistantMessages(), ["first message"])
})

test("superseded worker late finalization is rejected", () => {
  const store = new RunOwnershipStore()
  const oldRun = store.claim()
  assert.ok(oldRun)

  store.reset()
  const newRun = store.claim()
  assert.ok(newRun)

  assert.equal(store.finish(newRun.runId, "ready-for-review"), true)
  assert.equal(store.finish(oldRun.runId, "run-failed"), false)
  assert.equal(store.issue.status, "ready-for-review")
})

test("reset during an active run invalidates old writes before replacement", () => {
  const store = new RunOwnershipStore()
  const oldRun = store.claim()
  assert.ok(oldRun)

  store.reset()

  assert.equal(store.insertAssistantMessage(oldRun.runId, "late old"), false)
  const newRun = store.claim()
  assert.ok(newRun)
  assert.equal(store.insertAssistantMessage(newRun.runId, "new"), true)
  assert.deepEqual(store.assistantMessages(), ["new"])
})

test("stale leases can be recovered safely", () => {
  const store = new RunOwnershipStore()
  const staleRun = store.claim()
  assert.ok(staleRun)

  store.advance(121_000)
  const replacement = store.claim()

  assert.ok(replacement)
  assert.notEqual(replacement.runId, staleRun.runId)
  assert.equal(store.insertAssistantMessage(staleRun.runId, "stale"), false)
  assert.equal(store.insertAssistantMessage(replacement.runId, "fresh"), true)
  assert.deepEqual(store.assistantMessages(), ["fresh"])
})

function migrationSql(): string {
  return readFileSync(
    resolve(
      process.cwd(),
      "../../supabase/migrations/20260714200000_add_issue_run_ownership.sql"
    ),
    "utf8"
  )
}

type RunStatus = "active" | "finished" | "failed" | "held" | "superseded"
type IssueStatus =
  | "todo"
  | "queued"
  | "in-progress"
  | "ready-for-review"
  | "waiting-for-input"
  | "run-failed"

class RunOwnershipStore {
  readonly issue: { status: IssueStatus; activeRunId: string | null } = {
    status: "todo",
    activeRunId: null,
  }

  private now = 0
  private nextRun = 1
  private readonly leaseMs = 120_000
  private readonly runs = new Map<
    string,
    { status: RunStatus; leaseExpiresAt: number }
  >()
  private readonly messages: Array<{ runId: string; content: string }> = []

  claim(): { runId: string } | null {
    this.recoverStaleRuns()

    const activeRun = this.activeRun()
    if (activeRun && activeRun.leaseExpiresAt > this.now) {
      return null
    }
    if (this.issue.status !== "todo") {
      return null
    }

    const runId = `run-${this.nextRun}`
    this.nextRun += 1
    this.runs.set(runId, {
      status: "active",
      leaseExpiresAt: this.now + this.leaseMs,
    })
    this.issue.activeRunId = runId
    this.issue.status = "queued"
    return { runId }
  }

  reset(): void {
    const activeRun = this.activeRun()
    if (activeRun) {
      activeRun.status = "superseded"
    }
    this.issue.activeRunId = null
    this.issue.status = "todo"
    this.messages.length = 0
  }

  insertAssistantMessage(runId: string, content: string): boolean {
    if (!this.touch(runId)) {
      return false
    }
    this.messages.push({ runId, content })
    return true
  }

  finish(runId: string, status: IssueStatus): boolean {
    if (!this.touch(runId)) {
      return false
    }
    const run = this.runs.get(runId)
    if (!run) {
      return false
    }

    this.issue.status = status
    run.status = status === "run-failed" ? "failed" : "finished"
    return true
  }

  advance(ms: number): void {
    this.now += ms
  }

  assistantMessages(): string[] {
    return this.messages.map((message) => message.content)
  }

  private touch(runId: string): boolean {
    const run = this.runs.get(runId)
    if (
      !run ||
      run.status !== "active" ||
      this.issue.activeRunId !== runId
    ) {
      return false
    }

    run.leaseExpiresAt = this.now + this.leaseMs
    return true
  }

  private activeRun(): { status: RunStatus; leaseExpiresAt: number } | null {
    if (!this.issue.activeRunId) {
      return null
    }
    return this.runs.get(this.issue.activeRunId) ?? null
  }

  private recoverStaleRuns(): void {
    const activeRunId = this.issue.activeRunId
    const activeRun = this.activeRun()
    if (
      !activeRunId ||
      !activeRun ||
      activeRun.status !== "active" ||
      activeRun.leaseExpiresAt > this.now
    ) {
      return
    }

    activeRun.status = "superseded"
    this.issue.activeRunId = null
    if (this.issue.status === "queued" || this.issue.status === "in-progress") {
      this.issue.status = "todo"
    }
  }
}

function stubFetch(
  handler: (url: string, init: RequestInit) => Promise<Response>
): () => void {
  const originalFetch = globalThis.fetch
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) =>
    handler(String(url), init ?? {})) as typeof fetch
  return () => {
    globalThis.fetch = originalFetch
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}
