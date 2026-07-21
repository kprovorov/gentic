"use client"

import { useEffect, useMemo, useReducer } from "react"

import type {
  ChatMessageContract,
  MessageEvent,
} from "@gentic/validators/realtime"

import type { Attachment } from "./attachments"

export type ChatMessage = ChatMessageContract & {
  // Stable React key that survives optimistic-id -> server-id reconciliation.
  clientKey?: string
  pending?: "sending" | "failed"
  deliveryError?: string
  retryContent?: string
  retryFiles?: File[]
  attachments?: Attachment[]
}

type TranscriptEntity = ChatMessage

export type IssueChatState = {
  entities: Record<string, TranscriptEntity>
  order: string[]
  lastSeqById: Record<string, number>
}

export type IssueChatAction =
  | { type: "hydrate"; messages: ChatMessage[] }
  | { type: "optimistic_send"; message: ChatMessage }
  | {
      type: "persisted_insert_update"
      message: ChatMessage
      optimisticId?: string
    }
  | { type: "stream_delta"; event: MessageEvent }
  | { type: "finalization"; event: MessageEvent }
  | {
      type: "failure"
      optimisticId: string
      error: string
      content: string
      files: File[]
    }
  | { type: "reconnect_reconciliation"; messages: ChatMessage[] }
  | { type: "reset"; messages: ChatMessage[] }

/**
 * Transcript invariants:
 * - `entities` is the only source used to render visible messages.
 * - Message identity is the durable row/broadcast id. `clientKey` is retained
 *   only to keep React and message-scroller anchors stable across optimistic
 *   reconciliation.
 * - Ordering is deterministic by `created_at`, then id; duplicate or reordered
 *   deliveries cannot reshuffle equal timestamps nondeterministically.
 * - Broadcast messages are monotonic per id by `seq`; stale stream/final events
 *   are ignored. Durable hydration/reconnect data can complete a streaming
 *   entity, but hydration never removes an in-flight entity that is absent from
 *   the server snapshot.
 * - Optimistic user messages are pending until server persistence replaces the
 *   temporary id. A failure marks that entity failed so teardown/retry is
 *   explicit and no hidden copy is kept elsewhere.
 * - Teardown is owned by the hook caller: unsubscribing realtime channels stops
 *   future dispatches, while reducer state is discarded when the component
 *   unmounts or receives an explicit reset.
 */
export function issueChatReducer(
  state: IssueChatState,
  action: IssueChatAction
): IssueChatState {
  switch (action.type) {
    case "hydrate":
      return mergeBatch(state, action.messages)
    case "optimistic_send":
      return upsertMessage(state, { ...action.message, pending: "sending" })
    case "persisted_insert_update":
      return upsertPersistedMessage(state, action.message, action.optimisticId)
    case "stream_delta":
      return upsertSequencedEvent(state, action.event, "streaming")
    case "finalization":
      return upsertSequencedEvent(state, action.event, action.event.status)
    case "failure":
      return markOptimisticFailed(state, action)
    case "reconnect_reconciliation":
      return mergeBatch(state, action.messages)
    case "reset":
      return createIssueChatState(action.messages)
  }
}

export function createIssueChatState(
  messages: ChatMessage[] = []
): IssueChatState {
  return mergeBatch({ entities: {}, order: [], lastSeqById: {} }, messages)
}

export function selectIssueChatMessages(state: IssueChatState): ChatMessage[] {
  return state.order.map((id) => state.entities[id]).filter(Boolean)
}

export function useIssueChat(initialMessages: ChatMessage[]) {
  const [state, dispatch] = useReducer(
    issueChatReducer,
    initialMessages,
    createIssueChatState
  )

  useEffect(() => {
    dispatch({ type: "hydrate", messages: initialMessages })
  }, [initialMessages])

  const messages = useMemo(() => selectIssueChatMessages(state), [state])

  return { messages, dispatch, state }
}

function mergeBatch(
  state: IssueChatState,
  messages: ChatMessage[]
): IssueChatState {
  return messages.reduce(
    (next, message) => upsertPersistedMessage(next, message),
    state
  )
}

function upsertPersistedMessage(
  state: IssueChatState,
  incoming: ChatMessage,
  optimisticId?: string
): IssueChatState {
  let next = state
  let clientKey = incoming.clientKey

  if (optimisticId && state.entities[optimisticId]) {
    clientKey = state.entities[optimisticId].clientKey ?? optimisticId
    next = removeMessage(state, optimisticId)
  }

  const merged = upsertMessage(next, {
    ...incoming,
    clientKey,
  })

  if (!incoming.event_seq) {
    return merged
  }

  return {
    ...merged,
    lastSeqById: {
      ...merged.lastSeqById,
      [incoming.id]: Math.max(
        merged.lastSeqById[incoming.id] ?? 0,
        incoming.event_seq
      ),
    },
  }
}

function upsertSequencedEvent(
  state: IssueChatState,
  event: MessageEvent,
  fallbackStatus: ChatMessage["status"]
): IssueChatState {
  const lastSeq = state.lastSeqById[event.id] ?? 0
  if (event.seq <= lastSeq) {
    return state
  }
  const existing = state.entities[event.id]
  if (existing && existing.status !== "streaming" && event.status === "streaming") {
    return {
      ...state,
      lastSeqById: {
        ...state.lastSeqById,
        [event.id]: event.seq,
      },
    }
  }

  const next = upsertMessage(state, {
    id: event.id,
    role: event.role,
    kind: event.kind,
    content: event.content,
    status: event.status ?? fallbackStatus,
    created_at: event.ts,
    event_id: event.event_id ?? null,
    run_id: event.run_id ?? null,
    event_type: event.event_type ?? null,
    event_status: event.event_status ?? null,
    event_ts: event.event_ts ?? null,
    event_seq: event.event_seq ?? null,
    tool_call_id: event.tool_call_id ?? null,
    payload: event.payload ?? null,
  })

  return {
    ...next,
    lastSeqById: {
      ...next.lastSeqById,
      [event.id]: event.seq,
    },
  }
}

function markOptimisticFailed(
  state: IssueChatState,
  action: Extract<IssueChatAction, { type: "failure" }>
): IssueChatState {
  const existing = state.entities[action.optimisticId]
  if (!existing) {
    return state
  }

  return upsertMessage(state, {
    ...existing,
    content: action.content,
    deliveryError: action.error,
    retryContent: action.content,
    retryFiles: action.files,
    status: "error",
    pending: "failed",
  })
}

function upsertMessage(
  state: IssueChatState,
  incoming: TranscriptEntity
): IssueChatState {
  const existing = state.entities[incoming.id]
  const merged = mergeEntity(existing, incoming)

  if (existing && sameEntity(existing, merged)) {
    return state
  }

  const entities = {
    ...state.entities,
    [incoming.id]: merged,
  }
  const order = sortMessageIds(
    state.order.includes(incoming.id)
      ? state.order
      : [...state.order, incoming.id],
    entities
  )

  return {
    ...state,
    entities,
    order,
  }
}

function removeMessage(state: IssueChatState, id: string): IssueChatState {
  const entities = { ...state.entities }
  const lastSeqById = { ...state.lastSeqById }
  delete entities[id]
  delete lastSeqById[id]

  return {
    entities,
    lastSeqById,
    order: state.order.filter((messageId) => messageId !== id),
  }
}

function mergeEntity(
  existing: TranscriptEntity | undefined,
  incoming: TranscriptEntity
): TranscriptEntity {
  if (!existing) {
    return incoming
  }

  const merged: TranscriptEntity = {
    ...existing,
    ...incoming,
    clientKey: existing.clientKey ?? incoming.clientKey,
    deliveryError: incoming.deliveryError ?? existing.deliveryError,
    retryContent: incoming.retryContent ?? existing.retryContent,
    retryFiles: incoming.retryFiles ?? existing.retryFiles,
    attachments: incoming.attachments ?? existing.attachments,
    pending: incoming.pending,
    status: dominantStatus(existing.status, incoming.status),
  }

  if (incoming.pending === undefined) {
    delete merged.pending
    delete merged.deliveryError
    delete merged.retryContent
    delete merged.retryFiles
  }
  if (merged.attachments === undefined) {
    delete merged.attachments
  }

  return merged
}

function dominantStatus(
  current: ChatMessage["status"],
  incoming: ChatMessage["status"]
): ChatMessage["status"] {
  if (incoming === "error" || current === "error") {
    return "error"
  }
  if (incoming === "complete" || current === "complete") {
    return "complete"
  }
  return "streaming"
}

function sortMessageIds(
  ids: string[],
  entities: Record<string, TranscriptEntity>
): string[] {
  return [...ids].sort((left, right) => {
    const leftMessage = entities[left]
    const rightMessage = entities[right]
    const byTime = leftMessage.created_at.localeCompare(rightMessage.created_at)

    if (byTime !== 0) {
      return byTime
    }

    return left.localeCompare(right)
  })
}

function sameEntity(left: TranscriptEntity, right: TranscriptEntity): boolean {
  return (
    left.id === right.id &&
    left.clientKey === right.clientKey &&
    left.role === right.role &&
    left.kind === right.kind &&
    left.content === right.content &&
    left.status === right.status &&
    left.created_at === right.created_at &&
    left.pending === right.pending &&
    left.attachments === right.attachments
  )
}
