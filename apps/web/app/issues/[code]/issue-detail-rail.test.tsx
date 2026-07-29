import type React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const updateIssuePriorityMock = vi.fn()
const updateIssueStatusMock = vi.fn()
const addIssueRelationMock = vi.fn()
const deleteIssueRelationMock = vi.fn()
const toastErrorMock = vi.fn()

vi.mock("@/app/issues/actions", () => ({
  addIssueRelation: (formData: FormData) => addIssueRelationMock(formData),
  deleteIssueRelation: (formData: FormData) =>
    deleteIssueRelationMock(formData),
  updateIssuePriority: (formData: FormData) =>
    updateIssuePriorityMock(formData),
  updateIssueStatus: (formData: FormData) => updateIssueStatusMock(formData),
}))

vi.mock("sonner", () => ({
  toast: {
    error: (message: string) => toastErrorMock(message),
  },
}))

vi.mock("@gentic/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect,
  }: {
    children: React.ReactNode
    disabled?: boolean
    onSelect?: () => void
  }) => (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => onSelect?.()}
    >
      {children}
    </button>
  ),
}))

import { queryKeys } from "@/app/query-keys"

import { IssueDetailRail } from "./issue-detail-rail"

const issueId = "11111111-1111-4111-8111-111111111111"

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false, networkMode: "always" },
    },
  })
}

function renderRail(queryClient = createQueryClient()) {
  queryClient.setQueryData(queryKeys.issue(issueId), {
    issue: { id: issueId, priority: "medium" },
  })
  queryClient.setQueryData(queryKeys.issues, {
    issues: [{ id: issueId, priority: "medium" }],
    blockedIssueIds: [],
    blockingIssueIds: [],
  })

  render(
    <QueryClientProvider client={queryClient}>
      <IssueDetailRail
        issueId={issueId}
        issueCode="GEN-1"
        status="todo"
        priority="medium"
        pullRequests={[]}
        relations={[]}
        relationCandidates={[]}
      />
    </QueryClientProvider>
  )

  return queryClient
}

afterEach(() => {
  vi.clearAllMocks()
})

describe("IssueDetailRail priority", () => {
  it("submits selected priority and applies optimistic detail/list updates", async () => {
    const user = userEvent.setup()
    const queryClient = renderRail()
    let resolveMutation: () => void = () => {}
    updateIssuePriorityMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveMutation = resolve
        })
    )

    await user.click(screen.getByRole("menuitem", { name: "High" }))

    expect(updateIssuePriorityMock).toHaveBeenCalledTimes(1)
    const formData = updateIssuePriorityMock.mock.calls[0][0] as FormData
    expect(formData.get("id")).toBe(issueId)
    expect(formData.get("priority")).toBe("high")
    expect(
      screen.getByRole("button", { name: "Change priority from High" })
    ).toBeVisible()
    expect(
      queryClient.getQueryData<{ issue: { priority: string } }>(
        queryKeys.issue(issueId)
      )?.issue.priority
    ).toBe("high")
    expect(
      queryClient.getQueryData<{ issues: Array<{ priority: string }> }>(
        queryKeys.issues
      )?.issues[0]?.priority
    ).toBe("high")

    resolveMutation()
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Change priority from Medium" })
      ).not.toBeDisabled()
    })
  })

  it("disables the priority dropdown while saving", async () => {
    const user = userEvent.setup()
    let resolveMutation: () => void = () => {}
    updateIssuePriorityMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveMutation = resolve
        })
    )
    renderRail()

    await user.click(screen.getByRole("menuitem", { name: "Urgent" }))

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Change priority from Urgent" })
      ).toBeDisabled()
    })

    resolveMutation()
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Change priority from Medium" })
      ).not.toBeDisabled()
    })
  })

  it("rolls back optimistic priority and shows an error toast when saving fails", async () => {
    const user = userEvent.setup()
    const queryClient = renderRail()
    updateIssuePriorityMock.mockRejectedValue(new Error("network failed"))

    await user.click(screen.getByRole("menuitem", { name: "Low" }))

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Failed to update issue priority"
      )
    })
    expect(
      screen.getByRole("button", { name: "Change priority from Medium" })
    ).toBeVisible()
    expect(
      queryClient.getQueryData<{ issue: { priority: string } }>(
        queryKeys.issue(issueId)
      )?.issue.priority
    ).toBe("medium")
  })
})
