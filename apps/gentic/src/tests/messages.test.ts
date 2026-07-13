import assert from "node:assert/strict"
import { test } from "node:test"

import type { AgentApi, InsertMessageInput } from "../api.js"
import { StreamingAssistantMessage, publishMessage } from "../messages.js"
import type { IssueRealtimeChannel, RealtimeMessageEvent } from "../realtime.js"
import { runTurn } from "../session.js"

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
