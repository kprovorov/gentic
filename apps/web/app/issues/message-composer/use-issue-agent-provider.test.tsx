import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const resetIssueAgentMock = vi.fn()
const updateIssueAgentProviderMock = vi.fn()
const toastErrorMock = vi.fn()

vi.mock("sonner", () => ({
  toast: { error: (message: string) => toastErrorMock(message) },
}))

vi.mock("@/app/issues/actions", () => ({
  resetIssueAgent: (formData: FormData) => resetIssueAgentMock(formData),
  updateIssueAgentProvider: (formData: FormData) =>
    updateIssueAgentProviderMock(formData),
}))

vi.mock("@/app/query-keys", () => ({
  queryKeys: {
    home: ["home"],
    issues: ["issues"],
    issue: (id: string) => ["issues", id],
  },
}))

import {
  AGENT_SWITCH_ERROR_MESSAGE,
  useIssueAgentProvider,
} from "./use-issue-agent-provider"

function TestHarness({ issueId }: { issueId: string }) {
  const { onAgentModelChange } = useIssueAgentProvider({ issueId })

  return (
    <div>
      <button
        type="button"
        onClick={() =>
          onAgentModelChange("codex", null, { requiresReset: false })
        }
      >
        set-only
      </button>
      <button
        type="button"
        onClick={() =>
          onAgentModelChange("codex", null, { requiresReset: true })
        }
      >
        set-with-reset
      </button>
      <button
        type="button"
        onClick={() =>
          onAgentModelChange("codex", "gpt-5.6-sol", { requiresReset: false })
        }
      >
        set-model-only
      </button>
      <button
        type="button"
        onClick={() =>
          onAgentModelChange("codex", "gpt-5.6-sol", { requiresReset: true })
        }
      >
        set-model-with-reset
      </button>
    </div>
  )
}

function renderHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false, networkMode: "always" },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <TestHarness issueId="11111111-1111-4111-8111-111111111111" />
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.clearAllMocks()
})

describe("useIssueAgentProvider", () => {
  it("calls updateIssueAgentProvider when no reset is required", async () => {
    const user = userEvent.setup()
    updateIssueAgentProviderMock.mockResolvedValue(undefined)
    renderHarness()

    await user.click(screen.getByRole("button", { name: "set-only" }))

    expect(updateIssueAgentProviderMock).toHaveBeenCalledTimes(1)
    expect(resetIssueAgentMock).not.toHaveBeenCalled()
    const formData = updateIssueAgentProviderMock.mock.calls[0][0] as FormData
    expect(formData.get("id")).toBe("11111111-1111-4111-8111-111111111111")
    expect(formData.get("agent_provider")).toBe("codex")
    expect(formData.get("issue_model")).toBe("")
  })

  it("calls resetIssueAgent (the same destructive path as retry) when a reset is required", async () => {
    const user = userEvent.setup()
    resetIssueAgentMock.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      created_at: "2026-07-14T00:00:00.000Z",
    })
    renderHarness()

    await user.click(screen.getByRole("button", { name: "set-with-reset" }))

    expect(resetIssueAgentMock).toHaveBeenCalledTimes(1)
    expect(updateIssueAgentProviderMock).not.toHaveBeenCalled()
    const formData = resetIssueAgentMock.mock.calls[0][0] as FormData
    expect(formData.get("id")).toBe("11111111-1111-4111-8111-111111111111")
    expect(formData.get("agent_provider")).toBe("codex")
    expect(formData.get("issue_model")).toBe("")
  })

  it("updates the issue model without reset when no reset is required", async () => {
    const user = userEvent.setup()
    updateIssueAgentProviderMock.mockResolvedValue(undefined)
    renderHarness()

    await user.click(screen.getByRole("button", { name: "set-model-only" }))

    expect(updateIssueAgentProviderMock).toHaveBeenCalledTimes(1)
    expect(resetIssueAgentMock).not.toHaveBeenCalled()
    const formData = updateIssueAgentProviderMock.mock.calls[0][0] as FormData
    expect(formData.get("agent_provider")).toBe("codex")
    expect(formData.get("issue_model")).toBe("gpt-5.6-sol")
  })

  it("resets the issue when changing model after messages exist", async () => {
    const user = userEvent.setup()
    resetIssueAgentMock.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      created_at: "2026-07-14T00:00:00.000Z",
    })
    renderHarness()

    await user.click(
      screen.getByRole("button", { name: "set-model-with-reset" })
    )

    expect(resetIssueAgentMock).toHaveBeenCalledTimes(1)
    expect(updateIssueAgentProviderMock).not.toHaveBeenCalled()
    const formData = resetIssueAgentMock.mock.calls[0][0] as FormData
    expect(formData.get("agent_provider")).toBe("codex")
    expect(formData.get("issue_model")).toBe("gpt-5.6-sol")
  })

  // The picker keeps showing the old agent either way, so a rejected switch is
  // invisible unless it says something.
  it("says so when the reset behind a switch is rejected", async () => {
    const user = userEvent.setup()
    resetIssueAgentMock.mockRejectedValue(new Error("Issue not found"))
    renderHarness()

    await user.click(screen.getByRole("button", { name: "set-with-reset" }))

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(AGENT_SWITCH_ERROR_MESSAGE)
    )
  })
})
