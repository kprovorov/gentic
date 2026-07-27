import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { IssueCreateForm } from "./issue-create-form"

vi.mock("@/app/issues/actions", () => ({
  runIssue: vi.fn(),
  saveIssueDraft: vi.fn(),
}))

const projects = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Gentic",
    repo: "openai/gentic",
    key: "GEN",
  },
]

describe("IssueCreateForm", () => {
  it("highlights the project select when running without a selected project", async () => {
    const user = userEvent.setup()

    render(<IssueCreateForm projects={projects} />)

    await user.type(
      screen.getByLabelText("Prompt"),
      "Fix the new issue form validation."
    )
    await user.click(screen.getByRole("button", { name: "Run issue" }))

    const projectSelect = screen.getByLabelText("Project")

    expect(projectSelect).toHaveAttribute("aria-invalid", "true")
    expect(projectSelect).toHaveAccessibleDescription(
      "Select a project before running this issue."
    )
    expect(
      screen.getByText("Select a project before running this issue.")
    ).toBeVisible()
  })

  it("preselects the configured default agent", () => {
    render(<IssueCreateForm projects={projects} defaultAgentProvider="codex" />)

    expect(screen.getByText("Codex")).toBeVisible()
    expect(screen.getByDisplayValue("codex")).toHaveAttribute(
      "name",
      "agent_provider"
    )
  })
})
