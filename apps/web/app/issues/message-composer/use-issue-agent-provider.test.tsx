import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const resetIssueAgentMock = vi.fn()
const updateIssueAgentProviderMock = vi.fn()

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

import { useIssueAgentProvider } from "./use-issue-agent-provider"

function TestHarness({ issueId }: { issueId: string }) {
  const { onAgentProviderChange } = useIssueAgentProvider({ issueId })

  return (
    <div>
      <button
        type="button"
        onClick={() => onAgentProviderChange("codex", { requiresReset: false })}
      >
        set-only
      </button>
      <button
        type="button"
        onClick={() => onAgentProviderChange("codex", { requiresReset: true })}
      >
        set-with-reset
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
  })
})
