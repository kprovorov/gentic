import assert from "node:assert/strict"
import test from "node:test"

import {
  createIssueChatState,
  issueChatReducer,
  selectIssueChatMessages,
  type ChatMessage,
} from "./issue-chat-state"

const baseMessage = {
  role: "assistant",
  kind: "text",
  content: "hello",
  status: "complete",
} satisfies Pick<ChatMessage, "role" | "kind" | "content" | "status">

function message(fields: Partial<ChatMessage> & { id: string }): ChatMessage {
  return {
    ...baseMessage,
    created_at: "2026-07-14T00:00:00.000Z",
    ...fields,
  }
}

test("hydrates into deterministic created_at/id order", () => {
  const state = createIssueChatState([
    message({ id: "b", created_at: "2026-07-14T00:00:01.000Z" }),
    message({ id: "a", created_at: "2026-07-14T00:00:01.000Z" }),
    message({ id: "c", created_at: "2026-07-14T00:00:00.000Z" }),
  ])

  assert.deepEqual(
    selectIssueChatMessages(state).map(({ id }) => id),
    ["c", "a", "b"]
  )
})

test("optimistic delivery keeps a stable client key after persistence", () => {
  let state = createIssueChatState()
  state = issueChatReducer(state, {
    type: "optimistic_send",
    message: message({
      id: "optimistic-1",
      clientKey: "optimistic-1",
      role: "user",
      content: "ship it",
    }),
  })

  state = issueChatReducer(state, {
    type: "persisted_insert_update",
    optimisticId: "optimistic-1",
    message: message({
      id: "server-1",
      role: "user",
      content: "ship it",
      created_at: "2026-07-14T00:00:02.000Z",
    }),
  })

  assert.deepEqual(selectIssueChatMessages(state), [
    message({
      id: "server-1",
      clientKey: "optimistic-1",
      role: "user",
      content: "ship it",
      created_at: "2026-07-14T00:00:02.000Z",
    }),
  ])
})

test("reconnect reconciliation does not erase active streaming state", () => {
  let state = createIssueChatState()
  state = issueChatReducer(state, {
    type: "stream_delta",
    event: {
      id: "00000000-0000-4000-8000-000000000001",
      seq: 1,
      role: "assistant",
      kind: "text",
      content: "partial",
      status: "streaming",
      ts: "2026-07-14T00:00:03.000Z",
    },
  })

  state = issueChatReducer(state, {
    type: "reconnect_reconciliation",
    messages: [message({ id: "persisted-older", content: "older" })],
  })

  assert.deepEqual(
    selectIssueChatMessages(state).map(({ id, content, status }) => ({
      id,
      content,
      status,
    })),
    [
      { id: "persisted-older", content: "older", status: "complete" },
      {
        id: "00000000-0000-4000-8000-000000000001",
        content: "partial",
        status: "streaming",
      },
    ]
  )
})

test("reconnect reconciliation recovers a final answer after lost Broadcast", () => {
  let state = createIssueChatState()

  state = issueChatReducer(state, {
    type: "reconnect_reconciliation",
    messages: [
      message({
        id: "00000000-0000-4000-8000-000000000004",
        content: "durable final answer",
        status: "complete",
        created_at: "2026-07-14T00:00:02.000Z",
        event_seq: 2,
      }),
    ],
  })

  assert.deepEqual(
    selectIssueChatMessages(state).map(({ content, status }) => ({
      content,
      status,
    })),
    [{ content: "durable final answer", status: "complete" }]
  )
})

test("persisted final replaces streaming partial without duplicating", () => {
  let state = createIssueChatState()
  const id = "00000000-0000-4000-8000-000000000005"

  state = issueChatReducer(state, {
    type: "stream_delta",
    event: {
      id,
      seq: 1,
      role: "assistant",
      kind: "text",
      content: "partial",
      status: "streaming",
      ts: "2026-07-14T00:00:01.000Z",
    },
  })
  state = issueChatReducer(state, {
    type: "reconnect_reconciliation",
    messages: [
      message({
        id,
        content: "persisted final",
        status: "complete",
        created_at: "2026-07-14T00:00:02.000Z",
        event_seq: 2,
      }),
    ],
  })

  assert.deepEqual(
    selectIssueChatMessages(state).map(({ id: messageId, content, status }) => ({
      id: messageId,
      content,
      status,
    })),
    [{ id, content: "persisted final", status: "complete" }]
  )
})

test("persisted transcript wins over delayed streaming Broadcast", () => {
  let state = createIssueChatState([
    message({
      id: "00000000-0000-4000-8000-000000000006",
      content: "complete from database",
      status: "complete",
      event_seq: 2,
    }),
  ])

  state = issueChatReducer(state, {
    type: "stream_delta",
    event: {
      id: "00000000-0000-4000-8000-000000000006",
      seq: 1,
      role: "assistant",
      kind: "text",
      content: "partial",
      status: "streaming",
      ts: "2026-07-14T00:00:01.000Z",
    },
  })

  assert.deepEqual(
    selectIssueChatMessages(state).map(({ content, status }) => ({
      content,
      status,
    })),
    [{ content: "complete from database", status: "complete" }]
  )
})

test("duplicate and reordered stream events cannot regress content", () => {
  let state = createIssueChatState()
  const id = "00000000-0000-4000-8000-000000000002"

  state = issueChatReducer(state, {
    type: "stream_delta",
    event: {
      id,
      seq: 2,
      role: "assistant",
      kind: "text",
      content: "newer",
      status: "streaming",
      ts: "2026-07-14T00:00:03.000Z",
    },
  })
  state = issueChatReducer(state, {
    type: "stream_delta",
    event: {
      id,
      seq: 1,
      role: "assistant",
      kind: "text",
      content: "older",
      status: "streaming",
      ts: "2026-07-14T00:00:02.000Z",
    },
  })

  assert.equal(selectIssueChatMessages(state)[0]?.content, "newer")
})

test("finalization completes a streamed message and stale duplicates are ignored", () => {
  let state = createIssueChatState()
  const id = "00000000-0000-4000-8000-000000000003"

  state = issueChatReducer(state, {
    type: "stream_delta",
    event: {
      id,
      seq: 1,
      role: "assistant",
      kind: "text",
      content: "almost",
      status: "streaming",
      ts: "2026-07-14T00:00:03.000Z",
    },
  })
  state = issueChatReducer(state, {
    type: "finalization",
    event: {
      id,
      seq: 2,
      role: "assistant",
      kind: "text",
      content: "done",
      status: "complete",
      ts: "2026-07-14T00:00:04.000Z",
    },
  })
  state = issueChatReducer(state, {
    type: "stream_delta",
    event: {
      id,
      seq: 1,
      role: "assistant",
      kind: "text",
      content: "almost",
      status: "streaming",
      ts: "2026-07-14T00:00:03.000Z",
    },
  })

  assert.deepEqual(
    selectIssueChatMessages(state).map(({ content, status }) => ({
      content,
      status,
    })),
    [{ content: "done", status: "complete" }]
  )
})

test("failed optimistic sends remain visible with failed pending state", () => {
  let state = createIssueChatState()
  state = issueChatReducer(state, {
    type: "optimistic_send",
    message: message({
      id: "optimistic-2",
      clientKey: "optimistic-2",
      role: "user",
      content: "try me",
    }),
  })
  state = issueChatReducer(state, {
    type: "failure",
    optimisticId: "optimistic-2",
    error: "Network dropped",
    content: "try me",
    files: [],
  })

  assert.deepEqual(selectIssueChatMessages(state), [
    {
      ...message({
        id: "optimistic-2",
        clientKey: "optimistic-2",
        role: "user",
        content: "try me",
        status: "error",
      }),
      deliveryError: "Network dropped",
      pending: "failed",
      retryContent: "try me",
      retryFiles: [],
    },
  ])
})
