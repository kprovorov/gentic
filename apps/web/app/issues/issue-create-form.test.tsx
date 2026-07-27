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
  it("highlights the project picker when running without a selected project", async () => {
    const user = userEvent.setup()

    render(<IssueCreateForm projects={projects} />)

    await user.type(
      screen.getByLabelText("Prompt"),
      "Fix the new issue form validation."
    )
    await user.click(screen.getByRole("button", { name: "Run issue" }))

    const projectPicker = screen.getByLabelText("Project")

    expect(projectPicker).toHaveAttribute("data-invalid", "true")
    expect(projectPicker).toHaveAccessibleDescription(
      "Select a project before running this issue."
    )
    expect(
      screen.getByText("Select a project before running this issue.")
    ).toBeVisible()
  })

  it("stores the selected project in the issue form", async () => {
    const user = userEvent.setup()

    render(<IssueCreateForm projects={projects} />)

    await user.click(screen.getByLabelText("Project"))
    await user.click(screen.getByRole("menuitem", { name: /Gentic/ }))

    expect(screen.getByLabelText("Project")).toHaveTextContent(
      "Gentic (openai/gentic)"
    )
    expect(document.querySelector('input[name="project_id"]')).toHaveValue(
      projects[0].id
    )
  })
})
