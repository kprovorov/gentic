import type React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/app/issues/actions", () => ({
  addIssueRelation: vi.fn(),
  createManualIssuePullRequest: vi.fn(),
  deleteIssue: vi.fn(),
  deleteIssueRelation: vi.fn(),
  updateIssuePriority: vi.fn(),
  updateIssueStatus: vi.fn(),
  updateIssueTitle: vi.fn(),
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

// Radix menus need pointer APIs jsdom lacks; this suite only cares that the
// header's controls render.
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

import { IssueDetailHeader } from "./issue-detail-header"

const issue = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "GEN-1",
  number: 1,
  title: "Keep picked attachments readable",
  body: "Attachments overflow the request card on mobile.",
  status: "todo",
  priority: "medium",
  type: "bug",
  agent_provider: "claude_code",
  has_unpublished_agent_changes: false,
  projects: { key: "GEN", repo: "kprovorov/gentic" },
} as unknown as React.ComponentProps<typeof IssueDetailHeader>["issue"]

function renderHeader(
  props: Partial<React.ComponentProps<typeof IssueDetailHeader>> = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false, networkMode: "always" },
    },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <IssueDetailHeader
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

describe("IssueDetailHeader", () => {
  it("shows the request and the metadata pills alongside the title", () => {
    renderHeader()

    expect(screen.getByText(issue.title as string)).toBeVisible()
    expect(screen.getByRole("region", { name: "Request" })).toBeVisible()
    expect(screen.getByText(issue.body as string)).toBeVisible()
    expect(
      screen.getByRole("button", { name: "Open issue properties" })
    ).toBeVisible()
  })

  it("collapses the pills and the request together, keeping status and title", async () => {
    const user = userEvent.setup()
    renderHeader()

    await user.click(screen.getByRole("button", { name: "Hide issue details" }))

    expect(
      screen.queryByRole("region", { name: "Request" })
    ).not.toBeInTheDocument()
    expect(screen.queryByText(issue.body as string)).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Open issue properties" })
    ).not.toBeInTheDocument()
    expect(screen.getByText(issue.title as string)).toBeVisible()

    await user.click(screen.getByRole("button", { name: "Show issue details" }))

    expect(screen.getByText(issue.body as string)).toBeVisible()
  })
})
