import type React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/app/issues/actions", () => ({
  addIssueRelation: vi.fn(),
  createManualIssuePullRequest: vi.fn(),
  deleteIssueRelation: vi.fn(),
  updateIssuePriority: vi.fn(),
  updateIssueStatus: vi.fn(),
  updateIssueType: vi.fn(),
  addIssueLabels: vi.fn(),
  removeIssueLabels: vi.fn(),
  startAttachmentUploads: vi.fn(),
  finishAttachmentUploads: vi.fn(),
  deleteAttachment: vi.fn(),
}))

// The real field fetches the label catalog over the network for its search
// popover, which isn't available in this render-only suite.
vi.mock("@/app/issues/issue-labels-field", () => ({
  IssueLabelsField: () => <div>Labels field</div>,
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

// Radix menus need pointer APIs jsdom lacks; the dialog under test only cares
// that the pill controls render inside it.
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
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => (
    <button type="button" role="menuitem">
      {children}
    </button>
  ),
}))

import { IssuePropertiesDialog } from "./issue-properties-dialog"

const issueId = "11111111-1111-4111-8111-111111111111"

const issue = {
  id: issueId,
  code: "GEN-1",
  number: 1,
  title: "Keep picked attachments readable",
  status: "todo",
  priority: "medium",
  type: "bug",
  agent_provider: "claude_code",
  has_unpublished_agent_changes: false,
  projects: { key: "GEN", repo: "kprovorov/gentic" },
} as unknown as React.ComponentProps<typeof IssuePropertiesDialog>["issue"]

function renderDialog(
  props: Partial<React.ComponentProps<typeof IssuePropertiesDialog>> = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false, networkMode: "always" },
    },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <IssuePropertiesDialog
        issue={issue}
        pullRequests={[]}
        automaticPrPublishingInProgress={false}
        relations={[]}
        relationCandidates={[]}
        labels={[]}
        attachments={[]}
        {...props}
      />
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.clearAllMocks()
})

describe("IssuePropertiesDialog", () => {
  it("keeps the rail's contents behind the pill row's plus button", async () => {
    const user = userEvent.setup()
    renderDialog()

    expect(screen.queryByText("Properties")).not.toBeInTheDocument()

    await user.click(
      screen.getByRole("button", { name: "Open issue properties" })
    )

    expect(screen.getByText("Properties")).toBeVisible()
    // Every section the rail carries on desktop, including the Status block
    // that used to be xl-only.
    for (const section of [
      "Details",
      "Status",
      "Labels",
      "Pull requests",
      "Files",
      "Relations",
    ]) {
      expect(screen.getByText(section)).toBeVisible()
    }
  })

  it("exposes the type, agent, and repo pills the header only summarises", async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(
      screen.getByRole("button", { name: "Open issue properties" })
    )

    expect(
      screen.getByRole("button", { name: "Change type from Bug" })
    ).toBeVisible()
    expect(screen.getByText("Claude Code")).toBeVisible()
    expect(screen.getByText("kprovorov/gentic")).toBeVisible()
  })

  it("offers the manual Create PR action that the rail gates on status", async () => {
    const user = userEvent.setup()
    renderDialog({
      issue: {
        ...issue,
        status: "ready-for-review",
        has_unpublished_agent_changes: true,
      },
    })

    await user.click(
      screen.getByRole("button", { name: "Open issue properties" })
    )

    expect(screen.getByRole("button", { name: "Create PR" })).toBeVisible()
  })
})
