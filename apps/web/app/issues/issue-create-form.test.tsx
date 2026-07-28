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
  it("stores the selected project from the dropdown", async () => {
    const user = userEvent.setup()

    render(<IssueCreateForm projects={projects} />)

    await user.click(screen.getByRole("button", { name: "Project" }))
    await user.click(screen.getByRole("menuitem", { name: /Gentic/ }))

    expect(screen.getByDisplayValue(projects[0].id)).toHaveAttribute(
      "name",
      "project_id"
    )
    expect(screen.getByText("Gentic")).toBeVisible()
  })

  it("highlights the project select when running without a selected project", async () => {
    const user = userEvent.setup()

    render(<IssueCreateForm projects={projects} />)

    await user.type(
      screen.getByLabelText("Prompt"),
      "Fix the new issue form validation."
    )
    await user.click(screen.getByRole("button", { name: "Run issue" }))

    const projectSelect = screen.getByRole("button", { name: "Project" })

    expect(projectSelect).toHaveAttribute("data-invalid", "true")
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

  it("stores the selected model from the selected agent", async () => {
    const user = userEvent.setup()

    render(<IssueCreateForm projects={projects} defaultAgentProvider="codex" />)

    await user.click(screen.getByRole("button", { name: "Choose model" }))
    await user.click(screen.getByRole("menuitem", { name: "GPT-5.6 Sol" }))

    expect(screen.getByText("GPT-5.6 Sol")).toBeVisible()
    expect(screen.getByDisplayValue("gpt-5.6-sol")).toHaveAttribute(
      "name",
      "issue_model"
    )
  })
})
