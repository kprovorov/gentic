import assert from "node:assert/strict"
import test from "node:test"

import { ensureTodoIssueHasPendingPrompt } from "../app/api/v1/agent/issues/claim/route"

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

class FakeSupabase {
  readonly inserts: Record<string, unknown>[] = []

  constructor(readonly pendingMessages: Record<string, unknown>[] = []) {}

  from(table: string) {
    assert.equal(table, "messages")
    return new FakeMessagesQuery(this)
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
