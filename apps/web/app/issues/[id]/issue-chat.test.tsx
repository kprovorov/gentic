import type React from "react"
import { act } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { IssueChat } from "./issue-chat"
import type { ChatMessage } from "./issue-chat-state"

const sendIssueMessageMock = vi.fn()
const invalidateQueriesMock = vi.fn()
let subscribeCallbacks: Array<(status: string) => void> = []
let online = true

vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

vi.mock("@gentic/supabase/client", () => ({
  useSupabaseClient: () => ({
    realtime: {
      setAuth: vi.fn().mockResolvedValue(undefined),
    },
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn((callback?: (status: string) => void) => {
        if (callback) {
          subscribeCallbacks.push(callback)
        }
        return {}
      }),
      send: vi.fn().mockResolvedValue(undefined),
    })),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock("@/app/issues/actions", () => ({
  sendIssueMessage: (formData: FormData) => sendIssueMessageMock(formData),
}))

vi.mock("@/app/query-keys", () => ({
  queryKeys: {
    issue: (id: string) => ["issue", id],
  },
}))

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-query")>()
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: invalidateQueriesMock,
    }),
  }
})

vi.mock("@gentic/ui/message-scroller", () => ({
  MessageScrollerProvider: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MessageScroller: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MessageScrollerViewport: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MessageScrollerContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MessageScrollerItem: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MessageScrollerButton: () => null,
  useMessageScroller: () => ({
    scrollToEnd: vi.fn(),
  }),
}))

function renderChat(messages: ChatMessage[] = [], status = "waiting-for-input") {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false, networkMode: "always" },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <IssueChat
        issueId="11111111-1111-4111-8111-111111111111"
        agentProvider="codex"
        initialMessages={messages}
        initialStatus={status as never}
        initialUsageLimitResetAt={null}
        initialPrUrl={null}
        initialPullRequests={[]}
      />
    </QueryClientProvider>
  )
}

function setOnline(value: boolean) {
  online = value
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => online,
  })
}

beforeEach(() => {
  subscribeCallbacks = []
  sendIssueMessageMock.mockReset()
  invalidateQueriesMock.mockReset()
  setOnline(true)
  window.dispatchEvent(new Event("online"))
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("IssueChat delivery state", () => {
  it("shows failed sends inline and retries the same text and attachment", async () => {
    const user = userEvent.setup()
    const file = new File(["log"], "error.log", { type: "text/plain" })
    sendIssueMessageMock.mockRejectedValueOnce(new Error("Network dropped"))
    sendIssueMessageMock.mockResolvedValueOnce({
      id: "22222222-2222-4222-8222-222222222222",
      created_at: "2026-07-14T00:00:00.000Z",
    })

    const { container } = renderChat()

    await user.type(screen.getByPlaceholderText(/Message the agent/), "Fix it")
    fireEvent.change(container.querySelector("input[type='file']")!, {
      target: { files: [file] },
    })
    await user.click(
      screen.getByRole("button", { name: "Send message to agent" })
    )

    expect(await screen.findByText("Failed to send")).toBeInTheDocument()
    expect(screen.getByText("Network dropped")).toBeInTheDocument()
    expect(screen.getAllByText("error.log").length).toBeGreaterThan(0)

    await user.click(screen.getByRole("button", { name: "Retry" }))

    await waitFor(() => expect(screen.getByText("Delivered")).toBeInTheDocument())
    const retryFormData = sendIssueMessageMock.mock.calls[1][0] as FormData
    expect(retryFormData.get("content")).toBe("Fix it")
    expect(retryFormData.getAll("files")).toEqual([file])
  })

  it("distinguishes sending, delivered, and agent processing states", async () => {
    const user = userEvent.setup()
    let resolveSend: (value: unknown) => void = () => {}
    sendIssueMessageMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve
        })
    )

    renderChat([], "in-progress")

    await user.type(
      screen.getByPlaceholderText(/Message the agent/),
      "Continue"
    )
    await user.click(
      screen.getByRole("button", { name: "Send message to agent" })
    )

    expect(await screen.findByText("Sending...")).toBeInTheDocument()

    await act(async () => {
      resolveSend({
        id: "33333333-3333-4333-8333-333333333333",
        created_at: "2026-07-14T00:00:00.000Z",
      })
    })

    expect(
      await screen.findByText("Delivered. Agent received it and is processing.")
    ).toBeInTheDocument()
  })

  it("surfaces reconnecting and offline recovery without disabling composition", async () => {
    const user = userEvent.setup()
    renderChat()

    await waitFor(() => expect(subscribeCallbacks.length).toBeGreaterThan(0))
    await act(async () => {
      subscribeCallbacks.forEach((callback) => callback("TIMED_OUT"))
    })

    expect(
      await screen.findByText(/Reconnecting to live updates/)
    ).toBeInTheDocument()

    setOnline(false)
    await act(async () => {
      window.dispatchEvent(new Event("offline"))
    })
    expect(await screen.findByText(/^Offline\./)).toBeInTheDocument()

    const textbox = screen.getByPlaceholderText(/Message the agent/)
    await user.type(textbox, "still typing")
    expect(textbox).toHaveValue("still typing")
    expect(
      screen.getByRole("button", { name: "Send message to agent" })
    ).toBeEnabled()
  })

  it("keeps keyboard submit and stable accessible labels", async () => {
    const user = userEvent.setup()
    sendIssueMessageMock.mockResolvedValue({
      id: "44444444-4444-4444-8444-444444444444",
      created_at: "2026-07-14T00:00:00.000Z",
    })

    renderChat()

    expect(screen.getByRole("button", { name: "Attach files" })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Send message to agent" })
    ).toBeDisabled()

    await user.type(screen.getByPlaceholderText(/Message the agent/), "Ship it")
    await user.keyboard("{Enter}")

    await waitFor(() => expect(sendIssueMessageMock).toHaveBeenCalledTimes(1))
    expect((sendIssueMessageMock.mock.calls[0][0] as FormData).get("content")).toBe(
      "Ship it"
    )
  })

  it("uses live regions for final responses and failures without streaming token spam", async () => {
    sendIssueMessageMock.mockRejectedValueOnce(new Error("Server unavailable"))

    renderChat([
      {
        id: "55555555-5555-4555-8555-555555555555",
        role: "assistant",
        kind: "text",
        content: "Done",
        status: "complete",
        created_at: "2026-07-14T00:00:00.000Z",
      },
    ])

    await waitFor(() => {
      const regions = screen.getAllByRole("status")
      expect(
        regions.some((region) =>
          within(region).queryByText("Agent response complete.")
        )
      ).toBe(true)
    })

    const user = userEvent.setup()
    await user.type(screen.getByPlaceholderText(/Message the agent/), "Again")
    await user.click(
      screen.getByRole("button", { name: "Send message to agent" })
    )

    expect(await screen.findByText("Server unavailable")).toBeInTheDocument()
    expect(
      screen.getByText("Message failed to send. Server unavailable")
    ).toBeInTheDocument()
  })
})
