import type React from "react"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { runIssue, saveIssueDraft } from "@/app/issues/actions"
import { TooltipProvider } from "@gentic/ui/tooltip"

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

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderForm(ui: React.ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

describe("IssueCreateForm", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", TestResizeObserver)
    window.localStorage.clear()
    vi.mocked(runIssue).mockClear()
    vi.mocked(saveIssueDraft).mockClear()
  })

  it("restores the saved prompt from browser storage", async () => {
    window.localStorage.setItem(
      "gentic:issue-create-draft:v1",
      "Keep this issue draft after refresh."
    )

    renderForm(<IssueCreateForm projects={projects} />)

    await waitFor(() => {
      expect(screen.getByLabelText("Prompt")).toHaveValue(
        "Keep this issue draft after refresh."
      )
    })
  })

  it("stores prompt changes in browser storage", async () => {
    const user = userEvent.setup()

    renderForm(<IssueCreateForm projects={projects} />)

    await user.type(
      screen.getByLabelText("Prompt"),
      "Persist this issue draft."
    )

    expect(window.localStorage.getItem("gentic:issue-create-draft:v1")).toBe(
      "Persist this issue draft."
    )
  })

  it("clears the saved prompt when submitting with a selected project", async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(
      "gentic:issue-create-draft:v1",
      "Persist until submit."
    )

    renderForm(<IssueCreateForm projects={projects} />)

    await waitFor(() => {
      expect(screen.getByLabelText("Prompt")).toHaveValue(
        "Persist until submit."
      )
    })
    await user.click(screen.getByRole("button", { name: "Project" }))
    await user.click(screen.getByRole("menuitem", { name: /Gentic/ }))
    await user.click(screen.getByRole("button", { name: "Run issue" }))

    expect(window.localStorage.getItem("gentic:issue-create-draft:v1")).toBe(
      null
    )
  })

  it("stores the selected project from the dropdown", async () => {
    const user = userEvent.setup()

    renderForm(<IssueCreateForm projects={projects} />)

    await user.click(screen.getByRole("button", { name: "Project" }))
    await user.click(screen.getByRole("menuitem", { name: /Gentic/ }))

    expect(screen.getByDisplayValue(projects[0].id)).toHaveAttribute(
      "name",
      "project_id"
    )
    expect(screen.getByText("Gentic")).toBeVisible()
  })

  it("defaults new issues to medium priority", () => {
    renderForm(<IssueCreateForm projects={projects} />)

    const priorityInput = screen.getByDisplayValue("medium")

    expect(screen.getByRole("button", { name: "Priority" })).toBeVisible()
    expect(screen.getByText("Medium")).toBeVisible()
    expect(priorityInput).toHaveAttribute("name", "priority")
  })

  it("stores the selected priority for the shared create form", async () => {
    const user = userEvent.setup()

    renderForm(<IssueCreateForm projects={projects} />)

    await user.click(screen.getByRole("button", { name: "Priority" }))
    await user.click(screen.getByRole("menuitem", { name: "Urgent" }))

    const priorityInput = screen.getByDisplayValue("urgent")
    const form = priorityInput.closest("form")

    expect(priorityInput).toHaveAttribute("name", "priority")
    expect(form).toContainElement(
      screen.getByRole("button", { name: "Save draft" })
    )
    expect(form).toContainElement(
      screen.getByRole("button", { name: "Run issue" })
    )
  })

  it("highlights the project select when running without a selected project", async () => {
    const user = userEvent.setup()

    renderForm(<IssueCreateForm projects={projects} />)

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
    renderForm(
      <IssueCreateForm projects={projects} defaultAgentProvider="codex" />
    )

    expect(screen.getByText("Codex")).toBeVisible()
    expect(screen.getByDisplayValue("codex")).toHaveAttribute(
      "name",
      "agent_provider"
    )
  })

  it("stores the selected model from the selected agent", async () => {
    const user = userEvent.setup()

    renderForm(
      <IssueCreateForm projects={projects} defaultAgentProvider="codex" />
    )

    await user.click(screen.getByRole("button", { name: "Choose model" }))
    await user.click(screen.getByRole("menuitem", { name: "GPT-5.6 Sol" }))

    expect(screen.getByText("GPT-5.6 Sol")).toBeVisible()
    expect(screen.getByDisplayValue("gpt-5.6-sol")).toHaveAttribute(
      "name",
      "issue_model"
    )
  })

  it("initializes automatic PR creation checked and submits it when running", async () => {
    const user = userEvent.setup()

    renderForm(<IssueCreateForm projects={projects} />)

    expect(
      screen.getByRole("checkbox", { name: "Create PR automatically" })
    ).toBeChecked()
    expect(screen.getByDisplayValue("true")).toHaveAttribute(
      "name",
      "create_pr_automatically"
    )

    await user.type(screen.getByLabelText("Prompt"), "Open a PR.")
    await user.click(screen.getByRole("button", { name: "Project" }))
    await user.click(screen.getByRole("menuitem", { name: /Gentic/ }))
    await user.click(screen.getByRole("button", { name: "Run issue" }))

    await waitFor(() => expect(runIssue).toHaveBeenCalled())
    const formData = vi.mocked(runIssue).mock.calls[0][0] as FormData
    expect(formData.get("create_pr_automatically")).toBe("true")
  })

  it("submits automatic PR creation unchecked when saving a draft", async () => {
    const user = userEvent.setup()

    renderForm(<IssueCreateForm projects={projects} />)

    await user.click(
      screen.getByRole("checkbox", { name: "Create PR automatically" })
    )
    expect(screen.getByDisplayValue("false")).toHaveAttribute(
      "name",
      "create_pr_automatically"
    )

    await user.type(screen.getByLabelText("Prompt"), "Keep this as a draft.")
    await user.click(screen.getByRole("button", { name: "Project" }))
    await user.click(screen.getByRole("menuitem", { name: /Gentic/ }))
    await user.click(screen.getByRole("button", { name: "Save draft" }))

    await waitFor(() => expect(saveIssueDraft).toHaveBeenCalled())
    const formData = vi.mocked(saveIssueDraft).mock.calls[0][0] as FormData
    expect(formData.get("create_pr_automatically")).toBe("false")
  })

  it("stores the selected project, priority, agent, model, and PR preference as settings", async () => {
    const user = userEvent.setup()

    renderForm(
      <IssueCreateForm projects={projects} defaultAgentProvider="codex" />
    )

    await user.click(screen.getByRole("button", { name: "Project" }))
    await user.click(screen.getByRole("menuitem", { name: /Gentic/ }))
    await user.click(screen.getByRole("button", { name: "Priority" }))
    await user.click(screen.getByRole("menuitem", { name: "Urgent" }))
    await user.click(screen.getByRole("button", { name: "Choose model" }))
    await user.click(screen.getByRole("menuitem", { name: "GPT-5.6 Sol" }))
    await user.click(
      screen.getByRole("checkbox", { name: "Create PR automatically" })
    )

    const stored = JSON.parse(
      window.localStorage.getItem("gentic:issue-create-settings:v1") ?? "{}"
    )

    expect(stored).toMatchObject({
      projectId: projects[0].id,
      priority: "urgent",
      agentProvider: "codex",
      issueModel: "gpt-5.6-sol",
      createPrAutomatically: false,
    })
  })

  it("restores stored settings from browser storage on mount", async () => {
    window.localStorage.setItem(
      "gentic:issue-create-settings:v1",
      JSON.stringify({
        projectId: projects[0].id,
        priority: "urgent",
        agentProvider: "codex",
        issueModel: "gpt-5.6-sol",
        createPrAutomatically: false,
      })
    )

    renderForm(<IssueCreateForm projects={projects} />)

    await waitFor(() => {
      expect(screen.getByText("Gentic")).toBeVisible()
      expect(screen.getByText("Urgent")).toBeVisible()
      expect(screen.getByText("Codex")).toBeVisible()
      expect(screen.getByText("GPT-5.6 Sol")).toBeVisible()
      expect(
        screen.getByRole("checkbox", { name: "Create PR automatically" })
      ).not.toBeChecked()
    })
  })

  it("does not restore a stored project that no longer exists", async () => {
    window.localStorage.setItem(
      "gentic:issue-create-settings:v1",
      JSON.stringify({ projectId: "deleted-project-id" })
    )

    renderForm(<IssueCreateForm projects={projects} />)

    await waitFor(() => {
      expect(screen.getByText("Select project")).toBeVisible()
    })
  })

  it("exposes the automatic PR tooltip by hover and keyboard focus", async () => {
    const user = userEvent.setup()

    renderForm(<IssueCreateForm projects={projects} />)

    const info = screen.getByRole("button", {
      name: "About Create PR automatically",
    })

    await user.hover(info)
    await waitFor(() => {
      expect(
        screen.getAllByText(/When the agent finishes with code changes/)[0]
      ).toBeVisible()
    })

    info.focus()
    expect(info).toHaveFocus()
    await waitFor(() => {
      expect(
        screen.getAllByText(/ready-for-review pull request/)[0]
      ).toBeVisible()
    })
  })
})
