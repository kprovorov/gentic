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
    await api.insertMessage(ISSUE_ID, RUN_ID, {
      id: "33333333-3333-4333-8333-333333333333",
      role: "assistant",
      content: "done",
    })
  } finally {
    restoreFetch()
  }

  assert.deepEqual(
    requests.map((request) => request.body),
    [
      { run_id: RUN_ID },
      {
        run_id: RUN_ID,
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
  assert.match(sql, /active_run_id uuid references public\.issue_runs/)
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
  const resetStart = sql.indexOf("create or replace function public.reset_issue_agent_run")
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

function migrationSql(): string {
  return readFileSync(
    resolve(
      process.cwd(),
      "../../supabase/migrations/20260714120000_add_issue_run_ownership.sql"
    ),
    "utf8"
  )
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
