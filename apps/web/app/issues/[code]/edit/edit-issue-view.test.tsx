import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { updateIssue } from "@/app/issues/actions"
import type { IssueEdit } from "@/app/queries"
import { TooltipProvider } from "@gentic/ui/tooltip"

import { EditIssueView } from "./edit-issue-view"

vi.mock("@/app/issues/actions", () => ({
  updateIssue: vi.fn(),
}))

vi.mock("@/app/client-queries", () => ({
  fetchIssueEditData: vi.fn(),
}))

const baseIssue: IssueEdit = {
  id: "8f14e45f-ceea-467e-b7ea-05a3e2b3f4c1",
  code: "GEN-7",
  number: 7,
  title: "Edit automatic PR setting",
  body: "Keep this issue editable.",
  agent_provider: "claude_code",
  issue_model: null,
  type: "feature",
  priority: "medium",
  create_pr_automatically: true,
  has_attached_pull_request: false,
  automatic_review_enabled: null,
  project_automatic_review: {
    enabled: false,
    provider: null,
    model: null,
    instructions: null,
  },
  automatic_review_policy: null,
  projects: {
    id: "3f14e45f-ceea-467e-b7ea-05a3e2b3f4c2",
    name: "Gentic",
    repo: "openai/gentic",
    key: "GEN",
  },
}

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderView(issue: IssueEdit = baseIssue) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <EditIssueView issueId={issue.id} initialData={issue} />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

describe("EditIssueView", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", TestResizeObserver)
    vi.mocked(updateIssue).mockClear()
  })

  it("shows automatic PR creation as editable and submits checked values", async () => {
    const user = userEvent.setup()

    renderView()

    expect(
      screen.getByRole("checkbox", { name: "Create PR automatically" })
    ).toBeChecked()
    expect(screen.getByDisplayValue("true")).toHaveAttribute(
      "name",
      "create_pr_automatically"
    )

    await user.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(updateIssue).toHaveBeenCalled())
    const formData = vi.mocked(updateIssue).mock.calls[0][0] as FormData
    expect(formData.get("create_pr_automatically")).toBe("true")
  })

  it("submits unchecked automatic PR creation while no PR is attached", async () => {
    const user = userEvent.setup()

    renderView()

    await user.click(
      screen.getByRole("checkbox", { name: "Create PR automatically" })
    )
    await user.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(updateIssue).toHaveBeenCalled())
    const formData = vi.mocked(updateIssue).mock.calls[0][0] as FormData
    expect(formData.get("create_pr_automatically")).toBe("false")
  })

  it("keeps automatic PR creation historical once a PR is attached", () => {
    renderView({
      ...baseIssue,
      has_attached_pull_request: true,
    })

    const checkbox = screen.getByRole("checkbox", {
      name: "Create PR automatically",
    })

    expect(checkbox).toBeDisabled()
    expect(checkbox).toHaveAccessibleDescription(
      "A pull request is already attached, so this setting is historical."
    )
    expect(
      document.querySelector("input[name='create_pr_automatically']")
    ).not.toBeInTheDocument()
  })

  it("submits an explicit automatic review override while no PR is attached", async () => {
    const user = userEvent.setup()

    renderView()

    await user.selectOptions(
      screen.getByLabelText("Automatic Code Review"),
      "Enabled"
    )
    await user.click(screen.getByRole("button", { name: "Save changes" }))

    await waitFor(() => expect(updateIssue).toHaveBeenCalled())
    const formData = vi.mocked(updateIssue).mock.calls[0][0] as FormData
    expect(formData.get("automatic_review_enabled")).toBe("true")
  })

  it("shows the frozen automatic review policy once a PR is attached", () => {
    renderView({
      ...baseIssue,
      has_attached_pull_request: true,
      automatic_review_enabled: true,
      automatic_review_policy: {
        enabled: true,
        reviewer_provider: "claude_code",
        reviewer_model: "claude-opus-5",
        reviewer_instructions: null,
        created_at: "2026-08-19T00:00:00.000Z",
      },
    })

    expect(
      screen.queryByLabelText("Automatic Code Review")
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(/Snapshotted when the first pull request/)
    ).toHaveTextContent("Enabled")
    expect(
      document.querySelector("input[name='automatic_review_enabled']")
    ).not.toBeInTheDocument()
  })
})
