import assert from "node:assert/strict"
import { test } from "node:test"

import type { AgentApi, InsertMessageInput } from "../api.js"
import { StreamingAssistantMessage, publishMessage } from "../messages.js"
import type { IssueRealtimeChannel, RealtimeMessageEvent } from "../realtime.js"
import { issueRunInstructions, runTurn } from "../session.js"

const ISSUE_ID = "11111111-1111-4111-8111-111111111111"

test("finalize inserts exactly once with the broadcast id", async () => {
  const api = fakeApi()
  const channel = fakeChannel()
  const message = new StreamingAssistantMessage(api, ISSUE_ID, channel, "text")

  await message.append("hello")
  await message.finalize()
  await message.finalize()

  assert.equal(api.inserted.length, 1)
  assert.equal(channel.messages.length, 2)
  assert.equal(api.inserted[0]?.issueId, ISSUE_ID)
  assert.equal(api.inserted[0]?.message.id, channel.messages[1]?.id)
  assert.equal(api.inserted[0]?.message.content, "hello")
  assert.equal(api.inserted[0]?.message.status, "complete")
})

test("finalize retries transient API failure", async () => {
  const api = fakeApi({
    failInsertAttempts: [new Error("temporary failure")],
  })
  const channel = fakeChannel()
  const message = new StreamingAssistantMessage(
    api,
    ISSUE_ID,
    channel,
    "thinking",
    150,
    { retryDelaysMs: [0] }
  )

  await message.append("thinking")
  await message.finalize()

  assert.equal(api.insertAttempts, 2)
  assert.equal(api.inserted.length, 1)
  assert.equal(api.inserted[0]?.message.id, channel.messages[1]?.id)
  assert.equal(api.inserted[0]?.message.kind, "thinking")
})

test("terminal persist failure does not reject finalize", async () => {
  const api = fakeApi({
    failInsertAttempts: [new Error("permanent failure")],
  })
  const channel = fakeChannel()
  const message = new StreamingAssistantMessage(
    api,
    ISSUE_ID,
    channel,
    "text",
    150,
    { retryDelaysMs: [] }
  )

  await message.append("delivered over broadcast")
  await assert.doesNotReject(() => message.finalize())

  assert.equal(api.insertAttempts, 1)
  assert.equal(api.inserted.length, 0)
  assert.equal(channel.messages.at(-1)?.status, "complete")
})

test("tool messages insert at emit time with the broadcast id", async () => {
  const api = fakeApi()
  const channel = fakeChannel()

  await publishMessage(api, ISSUE_ID, channel, {
    kind: "tool",
    content: "Read file",
  })

  assert.equal(channel.messages.length, 1)
  assert.equal(api.inserted.length, 1)
  assert.equal(api.inserted[0]?.message.id, channel.messages[0]?.id)
  assert.equal(api.inserted[0]?.message.kind, "tool")
  assert.equal(api.inserted[0]?.message.status, "complete")
})

test("runTurn maps text and thought chunks to structured stable events", async () => {
  const api = fakeApi()
  const channel = fakeChannel()
  const session = fakeSession([
    {
      sessionUpdate: "agent_message_chunk",
      messageId: "m1",
      content: { type: "text", text: "hello" },
    },
    {
      sessionUpdate: "agent_thought_chunk",
      messageId: "t1",
      content: { type: "text", text: "thinking" },
    },
  ])

  await runTurn(session as never, api, ISSUE_ID, channel, "prompt")

  assert.equal(api.inserted.length, 2)
  assert.equal(api.inserted[0]?.message.event_type, "text")
  assert.equal(api.inserted[0]?.message.event_id, "m1")
  assert.equal(api.inserted[0]?.message.run_id, "session-1")
  assert.equal(api.inserted[1]?.message.event_type, "thought")
  assert.equal(api.inserted[1]?.message.event_id, "t1")
  assert.match(api.inserted[0]?.message.id ?? "", /^[0-9a-f-]{36}$/)
})

test("runTurn updates tool calls through real statuses with one stable id", async () => {
  const api = fakeApi()
  const channel = fakeChannel()
  const session = fakeSession([
    {
      sessionUpdate: "tool_call",
      toolCallId: "tool-1",
      title: "Read package",
      kind: "read",
      status: "pending",
    },
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-1",
      status: "in_progress",
    },
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-1",
      status: "completed",
      content: [
        {
          type: "content",
          content: { type: "text", text: "package contents" },
        },
      ],
    },
  ])

  await runTurn(session as never, api, ISSUE_ID, channel, "prompt")

  assert.equal(api.inserted.length, 3)
  assert.deepEqual(
    api.inserted.map((entry) => entry.message.status),
    ["streaming", "streaming", "complete"]
  )
  assert.deepEqual(
    api.inserted.map((entry) => entry.message.event_status),
    ["pending", "in_progress", "completed"]
  )
  assert.equal(new Set(api.inserted.map((entry) => entry.message.id)).size, 1)
  assert.equal(channel.messages.at(-1)?.tool_call_id, "tool-1")
  assert.match(channel.messages.at(-1)?.content ?? "", /package contents/)
})

test("runTurn renders plan lifecycle events incrementally", async () => {
  const api = fakeApi()
  const channel = fakeChannel()
  const session = fakeSession([
    {
      sessionUpdate: "plan",
      entries: [
        { content: "Inspect", priority: "high", status: "in_progress" },
        { content: "Patch", priority: "medium", status: "pending" },
      ],
    },
    {
      sessionUpdate: "plan_update",
      plan: {
        type: "items",
        id: "main",
        entries: [
          { content: "Inspect", priority: "high", status: "completed" },
          { content: "Patch", priority: "medium", status: "completed" },
        ],
      },
    },
    {
      sessionUpdate: "plan_removed",
      id: "main",
    },
  ])

  await runTurn(session as never, api, ISSUE_ID, channel, "prompt")

  assert.equal(api.inserted.length, 3)
  assert.deepEqual(
    api.inserted.map((entry) => entry.message.kind),
    ["plan", "plan", "plan"]
  )
  assert.deepEqual(
    api.inserted.map((entry) => entry.message.event_status),
    ["in_progress", "completed", "removed"]
  )
  assert.match(api.inserted[0]?.message.content ?? "", /\[>\] Inspect/)
  assert.match(api.inserted[1]?.message.content ?? "", /\[x\] Patch/)
})

test("runTurn renders mode changes and available command updates", async () => {
  const api = fakeApi()
  const channel = fakeChannel()
  const session = fakeSession([
    {
      sessionUpdate: "current_mode_update",
      currentModeId: "plan",
    },
    {
      sessionUpdate: "available_commands_update",
      availableCommands: [
        { name: "plan", description: "Toggle plan mode" },
        {
          name: "/review",
          description: "Review changes",
          input: { hint: "optional target" },
        },
      ],
    },
  ])

  await runTurn(session as never, api, ISSUE_ID, channel, "prompt")

  assert.equal(api.inserted.length, 2)
  assert.equal(api.inserted[0]?.message.kind, "mode")
  assert.equal(api.inserted[0]?.message.event_type, "mode")
  assert.equal(api.inserted[0]?.message.content, "Mode: plan")
  assert.equal(api.inserted[1]?.message.kind, "commands")
  assert.equal(api.inserted[1]?.message.event_type, "available_commands")
  assert.match(api.inserted[1]?.message.content ?? "", /\/plan/)
  assert.deepEqual(api.inserted[1]?.message.payload, {
    availableCommands: [
      { name: "plan", description: "Toggle plan mode" },
      {
        name: "/review",
        description: "Review changes",
        input: { hint: "optional target" },
      },
    ],
  })
})

test("replayed ACP events use stable ids for dedupe", async () => {
  const updates = [
    {
      sessionUpdate: "tool_call",
      toolCallId: "same-tool",
      title: "Run tests",
      status: "in_progress",
    },
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "same-tool",
      status: "completed",
    },
  ]
  const firstApi = fakeApi()
  const secondApi = fakeApi()

  await runTurn(
    fakeSession(updates) as never,
    firstApi,
    ISSUE_ID,
    fakeChannel(),
    "prompt"
  )
  await runTurn(
    fakeSession(updates) as never,
    secondApi,
    ISSUE_ID,
    fakeChannel(),
    "prompt"
  )

  assert.deepEqual(
    secondApi.inserted.map((entry) => entry.message.id),
    firstApi.inserted.map((entry) => entry.message.id)
  )
  assert.deepEqual(
    secondApi.inserted.map((entry) => entry.message.event_seq),
    [1, 2]
  )
})

test("run error path best-effort persists the current partial", async () => {
  const api = fakeApi()
  const channel = fakeChannel()
  const session = {
    prompt: () => Promise.resolve(),
    nextUpdate: async () => {
      if (channel.messages.length === 0) {
        return {
          kind: "update",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "partial output" },
          },
        }
      }
      throw new Error("agent crashed")
    },
  }

  await assert.rejects(
    () => runTurn(session as never, api, ISSUE_ID, channel, "prompt"),
    /agent crashed/
  )

  assert.equal(api.inserted.length, 1)
  assert.equal(api.inserted[0]?.message.id, channel.messages.at(-1)?.id)
  assert.equal(api.inserted[0]?.message.content, "partial output")
  assert.equal(api.inserted[0]?.message.status, "error")
  assert.equal(channel.messages.at(-1)?.status, "error")
})

test("issue run instructions update an existing pull request on follow-up", () => {
  const instructions = issueRunInstructions("https://github.com/acme/app/pull/7")

  assert.match(instructions, /existing pull request branch/)
  assert.match(instructions, /Do not open a new pull request/)
  assert.doesNotMatch(instructions, /open a pull request against/)
})

function fakeChannel(): IssueRealtimeChannel & {
  messages: RealtimeMessageEvent[]
} {
  const messages: RealtimeMessageEvent[] = []
  return {
    messages,
    async publishMessage(event) {
      messages.push({ ...event, ts: new Date().toISOString() })
    },
    async publishRunState() {},
    async close() {},
  }
}

function fakeSession(updates: Array<Record<string, unknown>>) {
  let index = 0
  return {
    sessionId: "session-1",
    prompt: () => Promise.resolve(),
    nextUpdate: async () => {
      const update = updates[index]
      index += 1
      if (!update) {
        return { kind: "stop" }
      }
      return { kind: "update", update }
    },
  }
}

function fakeApi(options: { failInsertAttempts?: Error[] } = {}): AgentApi & {
  inserted: { issueId: string; message: InsertMessageInput }[]
  insertAttempts: number
} {
  const inserted: { issueId: string; message: InsertMessageInput }[] = []
  const api: AgentApi & {
    inserted: { issueId: string; message: InsertMessageInput }[]
    insertAttempts: number
  } = {
    inserted,
    insertAttempts: 0,
    async claimNextQueuedIssue() {
      return null
    },
    async setRunState() {},
    async insertMessage(issueId, message) {
      api.insertAttempts += 1
      const failure = options.failInsertAttempts?.shift()
      if (failure) {
        throw failure
      }
      inserted.push({ issueId, message })
      return message.id
    },
    async fetchUserMessagesAfter() {
      return []
    },
    async fetchAttachments() {
      return []
    },
    async fetchRealtimeToken() {
      return {
        url: "https://example.supabase.co",
        apiKey: "publishable",
        token: "token",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }
    },
  }
  return api
}
