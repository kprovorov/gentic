import assert from "node:assert/strict"
import { test } from "node:test"

import type { UserMessage } from "../api.js"
import { createPendingMessagePromptSource } from "../pending-messages.js"

const ISSUE_ID = "11111111-1111-4111-8111-111111111111"
const RUN_ID = "22222222-2222-4222-8222-222222222222"

test("startup drains unconsumed prompts in database sequence order", async () => {
  const api = fakePendingApi([
    [
      message("second", 2, "b"),
      message("first", 1, "a"),
    ],
  ])
  const source = createPendingMessagePromptSource({
    api,
    issueId: ISSUE_ID,
    runId: RUN_ID,
    pollIntervalMs: 0,
    buildPrompt: async (message) => message.content,
  })

  const first = await source.nextPrompt()
  assert.equal(first?.prompt, "first")
  await source.onPromptProcessed(first?.messageIds ?? [])

  const second = await source.nextPrompt()
  assert.equal(second?.prompt, "second")
  await source.onPromptProcessed(second?.messageIds ?? [])

  assert.deepEqual(api.acked, [
    { runId: RUN_ID, messageIds: ["a"] },
    { runId: RUN_ID, messageIds: ["b"] },
  ])
})

test("duplicate wake-ups do not re-deliver an in-flight prompt", async () => {
  const pending = [message("hello", 1, "a")]
  const api = fakePendingApi([pending, pending, pending, []])
  const source = createPendingMessagePromptSource({
    api,
    issueId: ISSUE_ID,
    runId: RUN_ID,
    pollIntervalMs: 0,
    buildPrompt: async (message) => message.content,
  })

  const first = await source.nextPrompt()
  assert.equal(first?.prompt, "hello")

  source.wake()
  source.wake()
  const duplicate = await source.nextPrompt()

  assert.equal(duplicate, null)
  await source.onPromptProcessed(first?.messageIds ?? [])
  assert.deepEqual(api.acked, [{ runId: RUN_ID, messageIds: ["a"] }])
})

test("polling picks up prompts without a realtime wake-up", async () => {
  const api = fakePendingApi([[], [message("after reconnect", 3, "c")]])
  const source = createPendingMessagePromptSource({
    api,
    issueId: ISSUE_ID,
    runId: RUN_ID,
    pollIntervalMs: 0,
    buildPrompt: async (message) => message.content,
  })

  const prompt = await source.nextPrompt()

  assert.equal(prompt?.prompt, "after reconnect")
  await source.onPromptProcessed(prompt?.messageIds ?? [])
  assert.deepEqual(api.acked, [{ runId: RUN_ID, messageIds: ["c"] }])
})

test("finish-window pending prompts keep the run open", async () => {
  const api = fakeFinishApi([false, true])

  assert.equal(await api.finishRun(), false)
  assert.equal(await api.finishRun(), true)
})

function message(content: string, seq: number, id: string): UserMessage {
  return {
    id,
    content,
    seq,
    created_at: new Date(seq).toISOString(),
  }
}

function fakePendingApi(fetches: UserMessage[][]) {
  const acked: { runId: string; messageIds: string[] }[] = []
  return {
    acked,
    async fetchPendingUserMessages() {
      return fetches.shift() ?? []
    },
    async ackUserMessages(
      _issueId: string,
      runId: string,
      messageIds: string[]
    ) {
      acked.push({ runId, messageIds })
    },
  }
}

function fakeFinishApi(results: boolean[]) {
  return {
    async finishRun() {
      return results.shift() ?? true
    },
  }
}
