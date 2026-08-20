import type React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  ISSUE_RETRY_RESET_EVENT,
  type IssueRetryResetEventDetail,
} from "../issue-retry-events"

vi.mock("@/app/issues/actions", () => ({
  startIssueMessage: vi.fn(),
  finishIssueMessage: vi.fn(),
  abandonIssueMessage: vi.fn(),
}))

type BroadcastHandler = (message: { payload: unknown }) => void

const broadcastHandlers = new Map<string, BroadcastHandler>()
let persistedMessages: unknown[] = []

// Enough of the Supabase client for the two channels the hook joins: the
// `postgres_changes` one and the private Broadcast one that carries the
// transcript. Handlers are captured so a test can push events at the hook the
// way a worker would.
vi.mock("@gentic/supabase/client", () => ({
  useSupabaseClient: () => ({
    realtime: { setAuth: async () => {} },
    removeChannel: async () => {},
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            returns: async () => ({ data: persistedMessages, error: null }),
          }),
        }),
      }),
    }),
    channel: () => {
      const channel = {
        on: (
          type: string,
          filter: { event?: string },
          handler: BroadcastHandler
        ) => {
          if (type === "broadcast" && filter.event) {
            broadcastHandlers.set(filter.event, handler)
          }
          return channel
        },
        subscribe: (callback?: (status: string) => void) => {
          callback?.("SUBSCRIBED")
          return channel
        },
        send: async () => {},
      }
      return channel
    },
  }),
}))

const { useIssueChatState } = await import("./use-issue-chat-state")

const issueId = "11111111-1111-4111-8111-111111111111"

function kickoffMessage(id: string, createdAt: string) {
  return {
    id,
    role: "user" as const,
    kind: "text" as const,
    content: "Work on Gentic issue GEN-1.",
    status: "complete" as const,
    author_type: "gentic" as const,
    generated_action: null,
    created_at: createdAt,
  }
}

function assistantBroadcast(
  runId: string,
  id: string,
  content: string,
  ts = "2026-08-20T12:30:00.000Z"
) {
  return {
    id,
    seq: 1,
    role: "assistant",
    kind: "text",
    content,
    status: "complete",
    author_type: "agent",
    run_id: runId,
    ts,
  }
}

function pushBroadcast(payload: unknown) {
  act(() => {
    broadcastHandlers.get("message")?.({ payload })
  })
}

function resetTo(message: ReturnType<typeof kickoffMessage>, runIds: string[]) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent<IssueRetryResetEventDetail>(ISSUE_RETRY_RESET_EVENT, {
        detail: {
          issueId,
          message,
          status: "todo",
          usageLimitResetAt: null,
          pullRequests: [],
          discardedRunIds: runIds,
        },
      })
    )
  })
}

function renderChat(initialMessages: ReturnType<typeof kickoffMessage>[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  return renderHook(
    () =>
      useIssueChatState({
        issueId,
        agentProvider: "claude_code",
        initialMessages,
        initialStatus: "in-progress",
        initialUsageLimitResetAt: null,
        initialPullRequests: [],
      }),
    { wrapper }
  )
}

describe("useIssueChatState after a reset", () => {
  beforeEach(() => {
    broadcastHandlers.clear()
    persistedMessages = []
  })

  // The bug: resetting wipes the transcript in the database, but the worker
  // that owned the wiped run keeps broadcasting. Its events were rebuilding
  // the conversation the user had just deleted, and nothing removed them
  // again — hydration and reconnect reconciliation merge rather than replace —
  // so the deleted chat survived until a full page reload.
  it("ignores the discarded run's late broadcasts", async () => {
    const original = kickoffMessage("kickoff-1", "2026-08-20T10:00:00.000Z")
    const { result } = renderChat([original])

    await waitFor(() => expect(broadcastHandlers.has("message")).toBe(true))

    pushBroadcast(
      assistantBroadcast(
        "run-1",
        "22222222-2222-4222-8222-222222222222",
        "GEN-415 already has an active run in progress"
      )
    )
    expect(result.current.displayedMessages).toHaveLength(2)

    const fresh = kickoffMessage("kickoff-2", "2026-08-20T12:31:00.000Z")
    resetTo(fresh, ["run-1"])

    expect(result.current.displayedMessages.map((m) => m.id)).toEqual([
      "kickoff-2",
    ])

    // The old worker is still alive and still streaming into the channel.
    pushBroadcast(
      assistantBroadcast(
        "run-1",
        "33333333-3333-4333-8333-333333333333",
        "still thinking about the old run"
      )
    )

    expect(result.current.displayedMessages.map((m) => m.id)).toEqual([
      "kickoff-2",
    ])
  })

  it("still shows the run that replaced the discarded one", async () => {
    const { result } = renderChat([
      kickoffMessage("kickoff-1", "2026-08-20T10:00:00.000Z"),
    ])

    await waitFor(() => expect(broadcastHandlers.has("message")).toBe(true))

    resetTo(kickoffMessage("kickoff-2", "2026-08-20T12:31:00.000Z"), ["run-1"])

    pushBroadcast(
      assistantBroadcast(
        "run-2",
        "44444444-4444-4444-8444-444444444444",
        "On it.",
        "2026-08-20T12:32:00.000Z"
      )
    )

    expect(result.current.displayedMessages.map((m) => m.content)).toEqual([
      "Work on Gentic issue GEN-1.",
      "On it.",
    ])
  })
})
