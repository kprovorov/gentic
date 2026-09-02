import type React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const updateIssuePriorityMock = vi.fn()
const updateIssueStatusMock = vi.fn()
const addIssueRelationMock = vi.fn()
const createManualIssuePullRequestMock = vi.fn()
const deleteIssueRelationMock = vi.fn()
const mergeIssuePullRequestActionMock = vi.fn()
const addIssueLabelsMock = vi.fn()
const removeIssueLabelsMock = vi.fn()
const startAttachmentUploadsMock = vi.fn()
const finishAttachmentUploadsMock = vi.fn()
const retryReviewRunActionMock = vi.fn()
const continueWithHumanReviewActionMock = vi.fn()
const startFreshImplementationActionMock = vi.fn()
const toastErrorMock = vi.fn()
const toastSuccessMock = vi.fn()

vi.mock("@/app/issues/actions", () => ({
  addIssueRelation: (formData: FormData) => addIssueRelationMock(formData),
  createManualIssuePullRequest: (formData: FormData) =>
    createManualIssuePullRequestMock(formData),
  deleteIssueRelation: (formData: FormData) =>
    deleteIssueRelationMock(formData),
  mergeIssuePullRequestAction: (formData: FormData) =>
    mergeIssuePullRequestActionMock(formData),
  updateIssuePriority: (formData: FormData) =>
    updateIssuePriorityMock(formData),
  updateIssueStatus: (formData: FormData) => updateIssueStatusMock(formData),
  addIssueLabels: (formData: FormData) => addIssueLabelsMock(formData),
  removeIssueLabels: (formData: FormData) => removeIssueLabelsMock(formData),
  startAttachmentUploads: (formData: FormData) =>
    startAttachmentUploadsMock(formData),
  finishAttachmentUploads: (formData: FormData) =>
    finishAttachmentUploadsMock(formData),
  retryReviewRunAction: (formData: FormData) =>
    retryReviewRunActionMock(formData),
  continueWithHumanReviewAction: (formData: FormData) =>
    continueWithHumanReviewActionMock(formData),
  startFreshImplementationAction: (formData: FormData) =>
    startFreshImplementationActionMock(formData),
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
        isSpec={false}
        hasUnpublishedAgentChanges={false}
        automaticPrPublishingInProgress={false}
        pullRequests={[]}
        relations={[]}
        relationCandidates={[]}
        labels={[]}
        attachments={[]}
        messageAttachments={[]}
        reviewCycles={[]}
        implementationOwner={null}
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
          head_sha: null,
          ci_state: "unknown",
          review_decision: "unknown",
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

describe("IssueDetailRail Merge PR", () => {
  const approvedPullRequest = {
    id: "22222222-2222-4222-8222-222222222222",
    issue_id: issueId,
    url: "https://github.com/acme/widget/pull/1",
    created_at: "2026-07-29T12:00:00.000Z",
    state: "open" as const,
    head_sha: "head-sha-1",
    ci_state: "success",
    review_decision: "approved",
  }

  it("offers the merge for an approved pull request", () => {
    renderRail(createQueryClient(), {
      status: "approved",
      pullRequests: [approvedPullRequest],
    })

    expect(screen.getByRole("button", { name: "Merge PR" })).toBeVisible()
  })

  it("does not offer the merge before the pull request is approved", () => {
    renderRail(createQueryClient(), {
      status: "ready-for-review",
      pullRequests: [
        { ...approvedPullRequest, review_decision: "review_required" },
      ],
    })

    expect(
      screen.queryByRole("button", { name: "Merge PR" })
    ).not.toBeInTheDocument()
  })

  it("merges the pull request the button belongs to", async () => {
    const user = userEvent.setup()
    vi.spyOn(window, "confirm").mockReturnValue(true)
    mergeIssuePullRequestActionMock.mockResolvedValue({
      ok: true,
      mergeMethod: "squash",
    })
    renderRail(createQueryClient(), {
      status: "approved",
      pullRequests: [
        approvedPullRequest,
        {
          ...approvedPullRequest,
          id: "33333333-3333-4333-8333-333333333333",
          url: "https://github.com/acme/widget/pull/2",
        },
      ],
    })

    await user.click(screen.getAllByRole("button", { name: "Merge PR" })[1])

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith("Pull request merged")
    })
    const formData = mergeIssuePullRequestActionMock.mock
      .calls[0][0] as FormData
    expect(formData.get("pull_request_id")).toBe(
      "33333333-3333-4333-8333-333333333333"
    )
  })

  // Merging cannot be undone from Gentic, so a dismissed confirmation has to
  // leave the pull request untouched.
  it("does not merge when the confirmation is dismissed", async () => {
    const user = userEvent.setup()
    vi.spyOn(window, "confirm").mockReturnValue(false)
    renderRail(createQueryClient(), {
      status: "approved",
      pullRequests: [approvedPullRequest],
    })

    await user.click(screen.getByRole("button", { name: "Merge PR" }))

    expect(mergeIssuePullRequestActionMock).not.toHaveBeenCalled()
  })

  // Every refusal the action returns names something the operator can act on
  // — a dismissed approval, a closed PR, a missing App permission — so it is
  // shown verbatim rather than folded into a generic failure.
  it("shows a returned refusal", async () => {
    const user = userEvent.setup()
    vi.spyOn(window, "confirm").mockReturnValue(true)
    mergeIssuePullRequestActionMock.mockResolvedValue({
      ok: false,
      error: "Pull request is not approved",
    })
    renderRail(createQueryClient(), {
      status: "approved",
      pullRequests: [approvedPullRequest],
    })

    await user.click(screen.getByRole("button", { name: "Merge PR" }))

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Pull request is not approved"
      )
    })
    expect(screen.getByRole("button", { name: "Merge PR" })).toBeVisible()
  })

  it("prevents duplicate clicks while the merge is in flight", async () => {
    const user = userEvent.setup()
    vi.spyOn(window, "confirm").mockReturnValue(true)
    let resolveMutation: () => void = () => {}
    mergeIssuePullRequestActionMock.mockImplementation(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          resolveMutation = () => resolve({ ok: true })
        })
    )
    renderRail(createQueryClient(), {
      status: "approved",
      pullRequests: [approvedPullRequest],
    })

    await user.dblClick(screen.getByRole("button", { name: "Merge PR" }))

    expect(mergeIssuePullRequestActionMock).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: "Merging..." })).toBeVisible()

    resolveMutation()
    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith("Pull request merged")
    })
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

  it("lists every file for download only, with no way to delete one", () => {
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
      messageAttachments: [
        {
          id: "attachment-2",
          fileName: "screenshot.png",
          sizeBytes: 4096,
          url: "https://signed.test/screenshot.png",
          thumbnailUrl: null,
        },
      ],
    })

    expect(screen.getByText("screenshot.png")).toBeVisible()
    expect(screen.getByText(/Sent in chat/)).toBeVisible()
    expect(
      screen.getByRole("link", { name: "Download screenshot.png" })
    ).toBeVisible()
    expect(screen.getByRole("link", { name: "Download spec.md" })).toBeVisible()
    // The issue is already submitted, so neither its own file nor the chat
    // file can be pulled out from under the run that was handed them.
    expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull()
  })

  it("uploads to the issue without sending a chat message", async () => {
    const user = userEvent.setup()
    startAttachmentUploadsMock.mockResolvedValue({
      uploads: [
        {
          attachmentId: "attachment-1",
          path: `${issueId}/notes.txt`,
          token: "upload-token",
          contentType: "text/plain",
        },
      ],
    })
    finishAttachmentUploadsMock.mockResolvedValue(undefined)
    renderRail(createQueryClient())

    expect(
      screen.getByText(/not sent to the agent as a message/i)
    ).toBeVisible()

    const file = new File(["hello"], "notes.txt", { type: "text/plain" })
    const input = screen.getByLabelText(
      "Attach files to this issue"
    ) as HTMLInputElement
    await user.upload(input, file)
    expect(input.files?.[0]?.name).toBe("notes.txt")

    await user.click(screen.getByRole("button", { name: "Upload" }))

    await waitFor(() => {
      expect(finishAttachmentUploadsMock).toHaveBeenCalledTimes(1)
    })

    // Only metadata crosses the action boundary — the bytes went to Storage
    // under the signed ticket, which is what keeps a 25MB file under the
    // Server Action body limit.
    const startData = startAttachmentUploadsMock.mock.calls[0]?.[0] as FormData
    expect(startData.get("issue_id")).toBe(issueId)
    expect(startData.getAll("files")).toEqual([])
    expect(JSON.parse(String(startData.get("attachments")))).toEqual([
      { name: "notes.txt", type: "text/plain", size: 5 },
    ])

    const finishData = finishAttachmentUploadsMock.mock
      .calls[0]?.[0] as FormData
    expect(finishData.getAll("attachment_id")).toEqual(["attachment-1"])
    // Nothing in this upload creates a message or wakes the agent.
    expect(finishData.get("content")).toBeNull()
    expect(finishData.get("client_message_id")).toBeNull()
  })
})

describe("IssueDetailRail automatic review", () => {
  it("shows per-PR attempt/verdict/findings and links to the published GitHub review", () => {
    renderRail(createQueryClient(), {
      pullRequests: [
        {
          id: "pr-1",
          issue_id: issueId,
          url: "https://github.com/acme/widget/pull/1",
          created_at: "2026-07-29T12:00:00.000Z",
          head_sha: "sha-1",
          ci_state: "success",
          review_decision: "changes_requested",
        },
      ],
      reviewCycles: [
        {
          id: "cycle-1",
          pullRequestId: "pr-1",
          state: "active",
          headSha: "sha-1",
          supersededReason: null,
          createdAt: "2026-07-29T12:01:00.000Z",
          updatedAt: "2026-07-29T12:01:00.000Z",
          runs: [
            {
              id: "run-1",
              status: "completed",
              error: null,
              headSha: "sha-1",
              startedAt: "2026-07-29T12:01:00.000Z",
              finishedAt: "2026-07-29T12:02:00.000Z",
              claimedByWorkerId: "worker-1",
              heartbeatAt: null,
              createdAt: "2026-07-29T12:01:00.000Z",
            },
          ],
          attempts: [
            {
              id: "attempt-1",
              attemptNumber: 1,
              verdict: "changes_requested",
              summary: null,
              githubReviewId: 555,
              publishedAt: "2026-07-29T12:02:00.000Z",
              createdAt: "2026-07-29T12:02:00.000Z",
              findings: [
                {
                  id: "finding-1",
                  severity: "warning",
                  filePath: "a.ts",
                  line: 10,
                  title: "Null deref",
                  body: null,
                  evidence: "line 10 dereferences without a null check",
                  impact: "crashes",
                  requestedChange: "add a null check",
                  githubCommentId: null,
                  createdAt: "2026-07-29T12:02:00.000Z",
                },
              ],
            },
          ],
        },
      ],
    })

    // Scoped to the review-cycle summary row: the Status dropdown's own
    // menu items include every possible status label, "Changes requested"
    // (the `changes-requested` issue status) among them.
    const summary = within(screen.getByText("1/3 attempts").closest("div")!)
    expect(summary.getByText("1/3 attempts")).toBeVisible()
    expect(summary.getByText("Changes requested")).toBeVisible()
    expect(summary.getByText("1 finding")).toBeVisible()
    expect(summary.getByRole("link", { name: "View review" })).toHaveAttribute(
      "href",
      "https://github.com/acme/widget/pull/1#pullrequestreview-555"
    )
  })

  it("shows an aggregate summary line across multiple pull requests", () => {
    renderRail(createQueryClient(), {
      pullRequests: [
        {
          id: "pr-1",
          issue_id: issueId,
          url: "https://github.com/acme/widget/pull/1",
          created_at: "2026-07-29T12:00:00.000Z",
          head_sha: "sha-1",
          ci_state: "success",
          review_decision: "approved",
        },
        {
          id: "pr-2",
          issue_id: issueId,
          url: "https://github.com/acme/widget/pull/2",
          created_at: "2026-07-29T12:00:00.000Z",
          head_sha: "sha-2",
          ci_state: "success",
          review_decision: "unknown",
        },
      ],
      reviewCycles: [
        {
          id: "cycle-1",
          pullRequestId: "pr-1",
          state: "approved",
          headSha: "sha-1",
          supersededReason: null,
          createdAt: "t",
          updatedAt: "t",
          runs: [],
          attempts: [],
        },
        {
          id: "cycle-2",
          pullRequestId: "pr-2",
          state: "active",
          headSha: "sha-2",
          supersededReason: null,
          createdAt: "t",
          updatedAt: "t",
          runs: [],
          attempts: [],
        },
      ],
    })

    expect(screen.getByText("1 of 2 pull requests reviewed")).toBeVisible()
  })

  it("shows Retry review only for a cycle stuck with no live run and budget remaining", () => {
    renderRail(createQueryClient(), {
      reviewCycles: [
        {
          id: "cycle-1",
          pullRequestId: "pr-1",
          state: "active",
          headSha: "sha-1",
          supersededReason: null,
          createdAt: "t",
          updatedAt: "t",
          runs: [
            {
              id: "run-1",
              status: "failed",
              error: "boom",
              headSha: "sha-1",
              startedAt: null,
              finishedAt: "t",
              claimedByWorkerId: null,
              heartbeatAt: null,
              createdAt: "t",
            },
            {
              id: "run-2",
              status: "failed",
              error: "boom again",
              headSha: "sha-1",
              startedAt: null,
              finishedAt: "t",
              claimedByWorkerId: null,
              heartbeatAt: null,
              createdAt: "t",
            },
          ],
          attempts: [],
        },
      ],
    })

    expect(screen.getByRole("button", { name: "Retry review" })).toBeVisible()
  })

  it("hides every recovery control once every cycle has concluded (approved/exhausted/superseded) — the stale-control guard", () => {
    renderRail(createQueryClient(), {
      reviewCycles: [
        {
          id: "cycle-1",
          pullRequestId: "pr-1",
          state: "approved",
          headSha: "sha-1",
          supersededReason: null,
          createdAt: "t",
          updatedAt: "t",
          runs: [],
          attempts: [],
        },
        {
          id: "cycle-2",
          pullRequestId: "pr-2",
          state: "exhausted",
          headSha: "sha-2",
          supersededReason: null,
          createdAt: "t",
          updatedAt: "t",
          runs: [],
          attempts: [
            {
              id: "attempt-1",
              attemptNumber: 3,
              verdict: "changes_requested",
              summary: null,
              githubReviewId: null,
              publishedAt: null,
              createdAt: "t",
              findings: [],
            },
          ],
        },
        {
          id: "cycle-3",
          pullRequestId: "pr-3",
          state: "superseded",
          headSha: "sha-3",
          supersededReason: "new_head_sha",
          createdAt: "t",
          updatedAt: "t",
          runs: [],
          attempts: [],
        },
      ],
    })

    expect(screen.queryByText("Review")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Retry review" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Continue with human review" })
    ).not.toBeInTheDocument()
  })

  it("shows Start fresh implementation session with the specific unavailable reason", () => {
    renderRail(createQueryClient(), {
      implementationOwner: {
        id: "owner-1",
        issueId,
        generation: 2,
        origin: "fresh_implementation",
        workerId: null,
        sessionId: "session-1",
        agentProvider: "claude_code",
        issueModel: null,
        establishedAt: "2026-07-29T12:00:00.000Z",
        resumable: false,
        unavailableReason: "worker_deleted",
      },
    })

    expect(
      screen.getByRole("button", {
        name: "Start fresh implementation session",
      })
    ).toBeVisible()
    expect(screen.getByText(/the original worker was deleted/)).toBeVisible()
  })
})
