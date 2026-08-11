import type React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { runIssue, saveIssueDraft } from "@/app/issues/actions"
import { createLabel } from "@/app/settings/actions"
import type { SettingsLabelsData } from "@/app/queries"
import { TooltipProvider } from "@gentic/ui/tooltip"

import { IssueCreateForm } from "./issue-create-form"

vi.mock("@/app/issues/actions", () => ({
  runIssue: vi.fn(),
  saveIssueDraft: vi.fn(),
}))

vi.mock("@/app/settings/actions", () => ({
  createLabel: vi.fn(),
}))

const projects = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Gentic",
    repo: "openai/gentic",
    key: "GEN",
  },
]

function label(overrides: Partial<SettingsLabelsData["labels"][number]>) {
  return {
    id: "label-bug",
    name: "Bug",
    color: "#2563EB",
    state: "active" as const,
    created_at: "2026-08-04T00:00:00.000Z",
    updated_at: "2026-08-04T00:00:00.000Z",
    assignment_count: 0,
    ...overrides,
  }
}

const defaultLabels = [
  label({ id: "label-bug", name: "Bug" }),
  label({ id: "label-feature", name: "Feature", color: "#16A34A" }),
]

function stubLabelsFetch(labels: SettingsLabelsData["labels"]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ labels }),
    })
  )
}

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderForm(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return {
    queryClient,
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>{ui}</TooltipProvider>
      </QueryClientProvider>
    ),
  }
}

describe("IssueCreateForm", () => {
  beforeEach(async () => {
    vi.stubGlobal("ResizeObserver", TestResizeObserver)
    stubLabelsFetch(defaultLabels)
    window.localStorage.clear()
    await new Promise<void>((resolve) => {
      const request = window.indexedDB.deleteDatabase("gentic-issue-draft")
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
    })
    vi.mocked(runIssue).mockClear()
    vi.mocked(saveIssueDraft).mockClear()
    vi.mocked(createLabel).mockReset()
  })

  it("restores the saved body from browser storage", async () => {
    window.localStorage.setItem(
      "gentic:issue-create-draft:v1",
      "Keep this issue draft after refresh."
    )

    renderForm(<IssueCreateForm projects={projects} />)

    await waitFor(() => {
      expect(screen.getByLabelText("Body")).toHaveValue(
        "Keep this issue draft after refresh."
      )
    })
  })

  it("stores body changes in browser storage", async () => {
    const user = userEvent.setup()

    renderForm(<IssueCreateForm projects={projects} />)

    await user.type(screen.getByLabelText("Body"), "Persist this issue draft.")

    expect(window.localStorage.getItem("gentic:issue-create-draft:v1")).toBe(
      "Persist this issue draft."
    )
  })

  it("clears the saved body when submitting with a selected project", async () => {
    const user = userEvent.setup()
    window.localStorage.setItem(
      "gentic:issue-create-draft:v1",
      "Persist until submit."
    )

    renderForm(<IssueCreateForm projects={projects} />)

    await waitFor(() => {
      expect(screen.getByLabelText("Body")).toHaveValue("Persist until submit.")
    })
    await user.click(screen.getByRole("button", { name: "Project" }))
    await user.click(screen.getByRole("menuitem", { name: /Gentic/ }))
    await user.click(screen.getByRole("button", { name: "Run Agent" }))

    expect(window.localStorage.getItem("gentic:issue-create-draft:v1")).toBe(
      null
    )
  })

  it("restores attached files from browser storage", async () => {
    const buffer = await new File(["contents"], "notes.txt", {
      type: "text/plain",
    }).arrayBuffer()
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open("gentic-issue-draft", 1)
      request.onupgradeneeded = () => request.result.createObjectStore("files")
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const request = db
        .transaction("files", "readwrite")
        .objectStore("files")
        .put(
          [{ name: "notes.txt", type: "text/plain", lastModified: 0, buffer }],
          "issue-create-draft-files:v1"
        )
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
    db.close()

    renderForm(<IssueCreateForm projects={projects} />)

    await waitFor(() => {
      expect(screen.getByText("notes.txt")).toBeVisible()
    })
  })

  it("stores attached files in browser storage and clears them on submit", async () => {
    const user = userEvent.setup()

    renderForm(<IssueCreateForm projects={projects} />)

    const file = new File(["contents"], "screenshot.png", {
      type: "image/png",
    })
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement
    await user.upload(input, file)

    await waitFor(() => {
      expect(screen.getByText("screenshot.png")).toBeVisible()
    })

    const readStoredFiles = () =>
      new Promise<{ name: string }[]>((resolve, reject) => {
        const request = window.indexedDB.open("gentic-issue-draft", 1)
        request.onsuccess = () => {
          const db = request.result
          const getRequest = db
            .transaction("files", "readonly")
            .objectStore("files")
            .get("issue-create-draft-files:v1")
          getRequest.onsuccess = () => {
            resolve((getRequest.result as { name: string }[] | undefined) ?? [])
            db.close()
          }
          getRequest.onerror = () => reject(getRequest.error)
        }
        request.onerror = () => reject(request.error)
      })

    await waitFor(async () => {
      const stored = await readStoredFiles()
      expect(stored).toHaveLength(1)
      expect(stored[0]?.name).toBe("screenshot.png")
    })

    await user.type(screen.getByLabelText("Body"), "Fix the layout.")
    await user.click(screen.getByRole("button", { name: "Project" }))
    await user.click(screen.getByRole("menuitem", { name: /Gentic/ }))
    await user.click(screen.getByRole("button", { name: "Run Agent" }))

    await waitFor(async () => {
      const stored = await readStoredFiles()
      expect(stored).toHaveLength(0)
    })
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
    expect(screen.getByText("openai/gentic")).toBeVisible()
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
      screen.getByRole("button", { name: "Save Draft" })
    )
    expect(form).toContainElement(
      screen.getByRole("button", { name: "Run Agent" })
    )
  })

  it("highlights the project select when running without a selected project", async () => {
    const user = userEvent.setup()

    renderForm(<IssueCreateForm projects={projects} />)

    await user.type(
      screen.getByLabelText("Body"),
      "Fix the new issue form validation."
    )
    await user.click(screen.getByRole("button", { name: "Run Agent" }))

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

    expect(
      screen.getByRole("button", { name: "Choose agent and model" })
    ).toHaveTextContent("Codex default")
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

    await user.click(
      screen.getByRole("button", { name: "Choose agent and model" })
    )
    await user.click(screen.getByRole("menuitem", { name: "GPT-5.6 Sol" }))

    expect(
      screen.getByRole("button", { name: "Choose agent and model" })
    ).toHaveTextContent("GPT-5.6 Sol")
    expect(screen.getByDisplayValue("gpt-5.6-sol")).toHaveAttribute(
      "name",
      "issue_model"
    )
  })

  it("initializes automatic PR creation checked and submits it when running", async () => {
    const user = userEvent.setup()

    renderForm(<IssueCreateForm projects={projects} />)

    expect(screen.getByDisplayValue("true")).toHaveAttribute(
      "name",
      "create_pr_automatically"
    )
    await user.click(screen.getByRole("button", { name: "More options" }))
    expect(
      screen.getByRole("checkbox", { name: "Create PR automatically" })
    ).toBeChecked()
    await user.keyboard("{Escape}")

    await user.type(screen.getByLabelText("Body"), "Open a PR.")
    await user.click(screen.getByRole("button", { name: "Project" }))
    await user.click(screen.getByRole("menuitem", { name: /Gentic/ }))
    await user.click(screen.getByRole("button", { name: "Run Agent" }))

    await waitFor(() => expect(runIssue).toHaveBeenCalled())
    const formData = vi.mocked(runIssue).mock.calls[0][0] as FormData
    expect(formData.get("create_pr_automatically")).toBe("true")
  })

  it("submits automatic PR creation unchecked when saving a draft", async () => {
    const user = userEvent.setup()

    renderForm(<IssueCreateForm projects={projects} />)

    await user.click(screen.getByRole("button", { name: "More options" }))
    await user.click(
      screen.getByRole("checkbox", { name: "Create PR automatically" })
    )
    expect(screen.getByDisplayValue("false")).toHaveAttribute(
      "name",
      "create_pr_automatically"
    )
    await user.keyboard("{Escape}")

    await user.type(screen.getByLabelText("Body"), "Keep this as a draft.")
    await user.click(screen.getByRole("button", { name: "Project" }))
    await user.click(screen.getByRole("menuitem", { name: /Gentic/ }))
    await user.click(screen.getByRole("button", { name: "Save Draft" }))

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
    await user.click(
      screen.getByRole("button", { name: "Choose agent and model" })
    )
    await user.click(screen.getByRole("menuitem", { name: "GPT-5.6 Sol" }))
    await user.click(screen.getByRole("button", { name: "More options" }))
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

    const { user } = renderForm(<IssueCreateForm projects={projects} />)

    await waitFor(() => {
      expect(screen.getByText("openai/gentic")).toBeVisible()
      expect(screen.getByText("Urgent")).toBeVisible()
      expect(
        screen.getByRole("button", { name: "Choose agent and model" })
      ).toHaveTextContent("GPT-5.6 Sol")
    })

    await user.click(screen.getByRole("button", { name: "More options" }))
    expect(
      screen.getByRole("checkbox", { name: "Create PR automatically" })
    ).not.toBeChecked()
  })

  it("does not restore a stored project that no longer exists", async () => {
    window.localStorage.setItem(
      "gentic:issue-create-settings:v1",
      JSON.stringify({ projectId: "deleted-project-id" })
    )

    renderForm(<IssueCreateForm projects={projects} />)

    await waitFor(() => {
      expect(screen.getByText("Select repository")).toBeVisible()
    })
  })

  it("exposes the automatic PR tooltip by hover and keyboard focus", async () => {
    const user = userEvent.setup()

    renderForm(<IssueCreateForm projects={projects} />)

    await user.click(screen.getByRole("button", { name: "More options" }))
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

  it("filters the label picker by search", async () => {
    const { user } = renderForm(<IssueCreateForm projects={projects} />)

    await user.click(screen.getByRole("button", { name: "More options" }))
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Bug" })).toBeVisible()
    })
    expect(screen.getByRole("checkbox", { name: "Feature" })).toBeVisible()

    await user.type(screen.getByPlaceholderText("Search labels"), "bu")

    expect(screen.getByRole("checkbox", { name: "Bug" })).toBeVisible()
    expect(
      screen.queryByRole("checkbox", { name: "Feature" })
    ).not.toBeInTheDocument()
  })

  it("selects and deselects a label from the overflow menu, toggling its hidden input", async () => {
    const { user } = renderForm(<IssueCreateForm projects={projects} />)

    await user.click(screen.getByRole("button", { name: "More options" }))
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Bug" })).toBeVisible()
    })

    await user.click(screen.getByRole("checkbox", { name: "Bug" }))

    expect(screen.getByDisplayValue("label-bug")).toHaveAttribute(
      "name",
      "label_id"
    )
    expect(screen.getByRole("checkbox", { name: "Bug" })).toBeChecked()

    await user.click(screen.getByRole("checkbox", { name: "Bug" }))

    expect(screen.queryByDisplayValue("label-bug")).not.toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: "Bug" })).not.toBeChecked()
  })

  it("creates a label inline, auto-selects it, and shows no color chooser", async () => {
    vi.mocked(createLabel).mockResolvedValue({
      label: label({ id: "label-chore", name: "Chore" }),
      restored: false,
    })
    const { user } = renderForm(<IssueCreateForm projects={projects} />)

    await user.click(screen.getByRole("button", { name: "More options" }))
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Bug" })).toBeVisible()
    })
    await user.type(screen.getByPlaceholderText("Search labels"), "Chore")

    expect(screen.queryByLabelText(/color/i)).not.toBeInTheDocument()
    expect(
      document.querySelector('input[type="color"]')
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Create.*Chore/ }))

    await waitFor(() => {
      expect(createLabel).toHaveBeenCalledTimes(1)
    })
    const formData = vi.mocked(createLabel).mock.calls[0][0] as FormData
    expect(formData.get("name")).toBe("Chore")
    expect(formData.get("color")).toBeNull()

    await waitFor(() => {
      expect(screen.getByDisplayValue("label-chore")).toHaveAttribute(
        "name",
        "label_id"
      )
    })
  })

  it("caps selection at 20 labels, disabling unselected rows and inline create while keeping selections removable", async () => {
    const manyLabels = Array.from({ length: 21 }, (_, index) =>
      label({
        id: `label-${String(index + 1).padStart(2, "0")}`,
        name: `Label ${String(index + 1).padStart(2, "0")}`,
      })
    )
    stubLabelsFetch(manyLabels)
    const { user } = renderForm(<IssueCreateForm projects={projects} />)

    await user.click(screen.getByRole("button", { name: "More options" }))
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Label 01" })).toBeVisible()
    })

    for (let index = 1; index <= 20; index += 1) {
      const name = `Label ${String(index).padStart(2, "0")}`
      await user.click(screen.getByRole("checkbox", { name }))
    }

    expect(screen.getByText("20/20")).toBeVisible()
    expect(screen.getByRole("checkbox", { name: "Label 21" })).toBeDisabled()

    await user.type(screen.getByPlaceholderText("Search labels"), "New one")
    expect(
      screen.getByRole("button", { name: /Create.*New one/ })
    ).toBeDisabled()

    await user.clear(screen.getByPlaceholderText("Search labels"))
    const firstSelected = screen.getByRole("checkbox", { name: "Label 01" })
    expect(firstSelected).not.toBeDisabled()
    await user.click(firstSelected)

    expect(screen.getByText("19/20")).toBeVisible()
  })

  it("keeps selected labels selected when the project changes", async () => {
    const { user } = renderForm(<IssueCreateForm projects={projects} />)

    await user.click(screen.getByRole("button", { name: "More options" }))
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Bug" })).toBeVisible()
    })
    await user.click(screen.getByRole("checkbox", { name: "Bug" }))
    expect(screen.getByDisplayValue("label-bug")).toHaveAttribute(
      "name",
      "label_id"
    )

    await user.click(screen.getByRole("button", { name: "Project" }))
    await user.click(screen.getByRole("menuitem", { name: /Gentic/ }))

    expect(screen.getByDisplayValue("label-bug")).toHaveAttribute(
      "name",
      "label_id"
    )
  })
})
