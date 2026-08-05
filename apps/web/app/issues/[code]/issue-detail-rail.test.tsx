import type React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const updateIssuePriorityMock = vi.fn()
const updateIssueStatusMock = vi.fn()
const addIssueRelationMock = vi.fn()
const createManualIssuePullRequestMock = vi.fn()
const deleteIssueRelationMock = vi.fn()
const addIssueLabelsMock = vi.fn()
const removeIssueLabelsMock = vi.fn()
const uploadAttachmentsMock = vi.fn()
const deleteAttachmentMock = vi.fn()
const toastErrorMock = vi.fn()
const toastSuccessMock = vi.fn()

vi.mock("@/app/issues/actions", () => ({
  addIssueRelation: (formData: FormData) => addIssueRelationMock(formData),
  createManualIssuePullRequest: (formData: FormData) =>
    createManualIssuePullRequestMock(formData),
  deleteIssueRelation: (formData: FormData) =>
    deleteIssueRelationMock(formData),
  updateIssuePriority: (formData: FormData) =>
    updateIssuePriorityMock(formData),
  updateIssueStatus: (formData: FormData) => updateIssueStatusMock(formData),
  addIssueLabels: (formData: FormData) => addIssueLabelsMock(formData),
  removeIssueLabels: (formData: FormData) => removeIssueLabelsMock(formData),
  uploadAttachments: (formData: FormData) => uploadAttachmentsMock(formData),
  deleteAttachment: (formData: FormData) => deleteAttachmentMock(formData),
}))

// The real field fetches the label catalog over the network for its search
// popover, which isn't available in this render-only suite; a minimal fake
// exposes the add/remove affordances IssueDetailLabels actually drives.
vi.mock("@/app/issues/issue-labels-field", () => ({
  IssueLabelsField: ({
    selectedIds,
    onSelectedIdsChange,
  }: {
    selectedIds: string[]
    onSelectedIdsChange: (ids: string[]) => void
  }) => (
    <div>
      <button
        type="button"
        onClick={() => onSelectedIdsChange([...selectedIds, "new-label"])}
      >
        Add label
      </button>
      {selectedIds.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() =>
            onSelectedIdsChange(
              selectedIds.filter((selectedId) => selectedId !== id)
            )
          }
        >
          Remove {id}
        </button>
      ))}
    </div>
  ),
}))

vi.mock("sonner", () => ({
  toast: {
    error: (message: string) => toastErrorMock(message),
    success: (message: string) => toastSuccessMock(message),
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

function renderRail(
  queryClient = createQueryClient(),
  props: Partial<React.ComponentProps<typeof IssueDetailRail>> = {}
) {
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
        hasUnpublishedAgentChanges={false}
        automaticPrPublishingInProgress={false}
        pullRequests={[]}
        relations={[]}
        relationCandidates={[]}
        labels={[]}
        attachments={[]}
        {...props}
      />
    </QueryClientProvider>
  )

  return queryClient
}

afterEach(() => {
  vi.clearAllMocks()
})

describe("IssueDetailRail manual Create PR", () => {
  it("shows the button in the Pull requests section when eligible", () => {
    renderRail(createQueryClient(), {
      status: "ready-for-review",
      hasUnpublishedAgentChanges: true,
    })

    expect(screen.getByRole("button", { name: "Create PR" })).toBeVisible()
  })

  it("does not show while automatic publishing is still running", () => {
    renderRail(createQueryClient(), {
      status: "ready-for-review",
      hasUnpublishedAgentChanges: true,
      automaticPrPublishingInProgress: true,
    })

    expect(
      screen.queryByRole("button", { name: "Create PR" })
    ).not.toBeInTheDocument()
  })

  it("does not show once a pull request is attached", () => {
    renderRail(createQueryClient(), {
      status: "ready-for-review",
      hasUnpublishedAgentChanges: true,
      pullRequests: [
        {
          id: "pr-1",
          issue_id: issueId,
          url: "https://github.com/acme/widget/pull/1",
          created_at: "2026-07-29T12:00:00.000Z",
        },
      ],
    })

    expect(
      screen.queryByRole("button", { name: "Create PR" })
    ).not.toBeInTheDocument()
  })

  it("prevents duplicate clicks while the request is pending", async () => {
    const user = userEvent.setup()
    let resolveMutation: () => void = () => {}
    createManualIssuePullRequestMock.mockImplementation(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          resolveMutation = () => resolve({ ok: true })
        })
    )
    renderRail(createQueryClient(), {
      status: "ready-for-review",
      hasUnpublishedAgentChanges: true,
    })

    await user.dblClick(screen.getByRole("button", { name: "Create PR" }))

    expect(createManualIssuePullRequestMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText("Requesting pull request...")).toBeVisible()

    resolveMutation()
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith("Create PR request sent")
    })
  })

  it("shows a returned failure and restores the button", async () => {
    const user = userEvent.setup()
    createManualIssuePullRequestMock.mockResolvedValue({
      ok: false,
      error: "Could not create request",
    })
    renderRail(createQueryClient(), {
      status: "ready-for-review",
      hasUnpublishedAgentChanges: true,
    })

    await user.click(screen.getByRole("button", { name: "Create PR" }))

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Could not create request")
    })
    expect(screen.getByRole("button", { name: "Create PR" })).toBeVisible()
  })

  it("shows an unexpected failure and restores the button", async () => {
    const user = userEvent.setup()
    createManualIssuePullRequestMock.mockRejectedValue(
      new Error("Network failed")
    )
    renderRail(createQueryClient(), {
      status: "ready-for-review",
      hasUnpublishedAgentChanges: true,
    })

    await user.click(screen.getByRole("button", { name: "Create PR" }))

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Network failed")
    })
    expect(screen.getByRole("button", { name: "Create PR" })).toBeVisible()
  })
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

describe("IssueDetailRail labels", () => {
  it("shows a placeholder when no labels are assigned", () => {
    renderRail(createQueryClient(), { labels: [] })

    expect(screen.getByText("No labels yet.")).toBeInTheDocument()
  })

  it("shows assigned label chips", () => {
    renderRail(createQueryClient(), {
      labels: [{ id: "label-1", name: "Bug", color: "#FF0000" }],
    })

    expect(screen.getByText("Bug")).toBeInTheDocument()
    expect(screen.queryByText("No labels yet.")).not.toBeInTheDocument()
  })

  it("adds a label through the multi-select field", async () => {
    const user = userEvent.setup()
    renderRail(createQueryClient(), { labels: [] })

    await user.click(screen.getByRole("button", { name: "Add label" }))

    expect(addIssueLabelsMock).toHaveBeenCalledTimes(1)
    const formData = addIssueLabelsMock.mock.calls[0][0] as FormData
    expect(formData.get("issue_id")).toBe(issueId)
    expect(formData.getAll("label_id")).toEqual(["new-label"])
    expect(removeIssueLabelsMock).not.toHaveBeenCalled()
  })

  it("removes a label through the multi-select field", async () => {
    const user = userEvent.setup()
    renderRail(createQueryClient(), {
      labels: [{ id: "label-1", name: "Bug", color: "#FF0000" }],
    })

    await user.click(screen.getByRole("button", { name: "Remove label-1" }))

    expect(removeIssueLabelsMock).toHaveBeenCalledTimes(1)
    const formData = removeIssueLabelsMock.mock.calls[0][0] as FormData
    expect(formData.get("issue_id")).toBe(issueId)
    expect(formData.getAll("label_id")).toEqual(["label-1"])
    expect(addIssueLabelsMock).not.toHaveBeenCalled()
  })
})

describe("IssueDetailRail relations", () => {
  it("shows each related issue's status icon", () => {
    renderRail(createQueryClient(), {
      relations: [
        {
          id: "relation-1",
          source_issue_id: issueId,
          target_issue_id: "22222222-2222-4222-8222-222222222222",
          created_at: "2026-07-30T12:00:00.000Z",
          type: "blocks",
          source_issue: {
            id: issueId,
            number: 1,
            title: "Current issue",
            status: "todo",
            projects: { key: "GEN" },
          },
          target_issue: {
            id: "22222222-2222-4222-8222-222222222222",
            number: 2,
            title: "Completed dependency",
            status: "completed",
            projects: { key: "GEN" },
          },
        },
        {
          id: "relation-2",
          source_issue_id: "33333333-3333-4333-8333-333333333333",
          target_issue_id: issueId,
          created_at: "2026-07-30T12:00:00.000Z",
          type: "blocks",
          source_issue: {
            id: "33333333-3333-4333-8333-333333333333",
            number: 3,
            title: "Failing blocker",
            status: "tests-failed",
            projects: { key: "GEN" },
          },
          target_issue: {
            id: issueId,
            number: 1,
            title: "Current issue",
            status: "todo",
            projects: { key: "GEN" },
          },
        },
      ],
    })

    expect(screen.getByLabelText("Completed status")).toHaveClass(
      "text-emerald-600"
    )
    expect(screen.getByLabelText("Tests failed status")).toHaveClass(
      "text-red-600"
    )
  })
})

describe("IssueDetailRail issue attachments", () => {
  it("lists the issue's durable files", () => {
    renderRail(createQueryClient(), {
      attachments: [
        {
          id: "attachment-1",
          fileName: "spec.md",
          sizeBytes: 2048,
          url: "https://signed.test/spec.md",
          thumbnailUrl: null,
        },
      ],
    })

    expect(screen.getByText("Files")).toBeVisible()
    expect(screen.getByText("spec.md")).toBeVisible()
  })

  it("uploads to the issue without sending a chat message", async () => {
    const user = userEvent.setup()
    uploadAttachmentsMock.mockResolvedValue(undefined)
    renderRail(createQueryClient())

    expect(
      screen.getByText(/not sent to the agent as a message/i)
    ).toBeVisible()

    const file = new File(["hello"], "notes.txt", { type: "text/plain" })
    const input = screen.getByLabelText(
      "Attach files to this issue"
    ) as HTMLInputElement
    await user.upload(input, file)
    // jsdom drops file inputs when constructing FormData from a form, so the
    // selection itself is asserted on the input.
    expect(input.files?.[0]?.name).toBe("notes.txt")

    await user.click(screen.getByRole("button", { name: "Upload" }))

    await waitFor(() => {
      expect(uploadAttachmentsMock).toHaveBeenCalledTimes(1)
    })

    const formData = uploadAttachmentsMock.mock.calls[0]?.[0] as FormData
    expect(formData.get("issue_id")).toBe(issueId)
    // Nothing in this upload creates a message or wakes the agent.
    expect(formData.get("content")).toBeNull()
    expect(formData.get("client_message_id")).toBeNull()
  })
})
