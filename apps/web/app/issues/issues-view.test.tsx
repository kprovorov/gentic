import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { HomeIssue, IssuesData } from "@/app/queries"
import { NewIssueDialog } from "@/components/new-issue-dialog"
import { NewIssueDialogProvider } from "@/components/new-issue-dialog-provider"
import { TooltipProvider } from "@gentic/ui/tooltip"

import { IssuesView } from "./issues-view"
import { bulkUpdateIssuePriority, updateIssuePriority } from "./actions"

const replace = vi.fn()
let searchParams = new URLSearchParams()

vi.mock("next/navigation", () => ({
  usePathname: () => "/issues",
  useRouter: () => ({
    replace,
    refresh: vi.fn(),
  }),
  useSearchParams: () => searchParams,
}))

vi.mock("@/components/realtime-refresh", () => ({
  RealtimeRefresh: () => null,
}))

vi.mock("./actions", () => ({
  bulkDeleteIssues: vi.fn().mockResolvedValue(undefined),
  bulkUpdateIssueAgentProvider: vi.fn().mockResolvedValue(undefined),
  bulkUpdateIssuePriority: vi.fn().mockResolvedValue(undefined),
  bulkUpdateIssueStatus: vi.fn().mockResolvedValue(undefined),
  updateIssuePriority: vi.fn().mockResolvedValue(undefined),
  updateIssueStatus: vi.fn().mockResolvedValue(undefined),
  runIssue: vi.fn().mockResolvedValue(undefined),
  saveIssueDraft: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

const project = {
  id: "project-1",
  name: "Gentic",
  repo: "openai/gentic",
  key: "GEN",
}

function issue(
  overrides: Partial<HomeIssue> & Pick<HomeIssue, "id" | "title">
) {
  return {
    code: `GEN-${overrides.id.slice(-1)}`,
    number: Number(overrides.id.slice(-1)) || 1,
    status: "todo",
    type: "feature",
    priority: "medium",
    created_at: "2026-07-01T00:00:00.000Z",
    pullRequests: [],
    projects: project,
    ...overrides,
    labels: overrides.labels ?? [],
  } satisfies HomeIssue
}

function renderIssuesView({
  data,
  view = "list",
}: {
  data: IssuesData
  view?: "list" | "table"
}) {
  searchParams = new URLSearchParams(view === "table" ? "view=table" : "")
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
        <TooltipProvider>
          <NewIssueDialogProvider>
            <IssuesView initialData={data} />
            <NewIssueDialog />
          </NewIssueDialogProvider>
        </TooltipProvider>
      </QueryClientProvider>
    ),
  }
}

function baseData(issues: HomeIssue[]): IssuesData {
  const labels = Array.from(
    new Map(
      issues.flatMap((currentIssue) =>
        currentIssue.labels.map((label) => [label.id, label] as const)
      )
    ).values()
  )
  return {
    issues,
    labels,
    blockedIssueIds: [],
    blockingIssueIds: [],
  }
}

function expectTextOrder(container: HTMLElement, orderedText: string[]) {
  const content = container.textContent ?? ""
  const positions = orderedText.map((text) => content.indexOf(text))

  for (const position of positions) {
    expect(position).toBeGreaterThanOrEqual(0)
  }

  expect(positions).toEqual([...positions].sort((a, b) => a - b))
}

describe("IssuesView priority triage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
  })

  it("orders issues by workflow status, urgent-to-low priority, then newest", () => {
    const { container } = renderIssuesView({
      data: baseData([
        issue({
          id: "11111111-1111-4111-8111-111111111111",
          title: "Old urgent todo",
          priority: "urgent",
          created_at: "2026-07-01T00:00:00.000Z",
        }),
        issue({
          id: "22222222-2222-4222-8222-222222222222",
          title: "New urgent todo",
          priority: "urgent",
          created_at: "2026-07-02T00:00:00.000Z",
        }),
        issue({
          id: "33333333-3333-4333-8333-333333333333",
          title: "Low todo",
          priority: "low",
          created_at: "2026-07-03T00:00:00.000Z",
        }),
        issue({
          id: "44444444-4444-4444-8444-444444444444",
          title: "Waiting input low",
          status: "waiting-for-input",
          priority: "low",
          created_at: "2026-07-04T00:00:00.000Z",
        }),
      ]),
    })

    expectTextOrder(container, [
      "Waiting input low",
      "New urgent todo",
      "Old urgent todo",
      "Low todo",
    ])
  })

  it("filters by multiple priorities and clears active priority filters", async () => {
    const { user } = renderIssuesView({
      data: baseData([
        issue({
          id: "11111111-1111-4111-8111-111111111111",
          title: "Urgent issue",
          priority: "urgent",
        }),
        issue({
          id: "22222222-2222-4222-8222-222222222222",
          title: "High issue",
          priority: "high",
        }),
        issue({
          id: "33333333-3333-4333-8333-333333333333",
          title: "Low issue",
          priority: "low",
        }),
      ]),
    })

    await user.click(screen.getByRole("button", { name: "Filters" }))
    await user.click(screen.getByRole("menuitem", { name: "Priority" }))
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Urgent" }))
    await user.click(screen.getByRole("menuitemcheckbox", { name: "High" }))

    expect(screen.getByText("Urgent issue")).toBeVisible()
    expect(screen.getByText("High issue")).toBeVisible()
    expect(screen.queryByText("Low issue")).not.toBeInTheDocument()

    await user.click(screen.getByRole("menuitem", { name: "Clear filter" }))

    expect(screen.getByText("Low issue")).toBeVisible()
  })

  it("optimistically updates an inline list priority and rolls back on error", async () => {
    let rejectUpdate: (error: Error) => void = () => undefined
    vi.mocked(updateIssuePriority).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectUpdate = reject
        })
    )
    const { user } = renderIssuesView({
      data: baseData([
        issue({
          id: "11111111-1111-4111-8111-111111111111",
          title: "Low issue",
          priority: "low",
        }),
      ]),
    })

    await user.click(
      screen.getAllByRole("button", { name: "Change priority from Low" })[0]
    )
    await user.click(screen.getByRole("menuitem", { name: "Urgent" }))

    expect(updateIssuePriority).toHaveBeenCalledTimes(1)
    expect(
      vi.mocked(updateIssuePriority).mock.calls[0][0].get("priority")
    ).toBe("urgent")
    await waitFor(() => {
      expect(
        screen.getAllByRole("button", {
          name: "Change priority from Urgent",
        })[0]
      ).toBeVisible()
    })

    rejectUpdate(new Error("nope"))

    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: "Change priority from Low" })[0]
      ).toBeVisible()
    })
  })

  it("bulk updates selected issue priorities optimistically", async () => {
    const { user } = renderIssuesView({
      data: baseData([
        issue({
          id: "11111111-1111-4111-8111-111111111111",
          title: "Low issue",
          priority: "low",
        }),
        issue({
          id: "22222222-2222-4222-8222-222222222222",
          title: "Medium issue",
          priority: "medium",
        }),
      ]),
    })

    await user.click(screen.getByRole("checkbox", { name: "Select GEN-1" }))
    await user.click(screen.getByRole("checkbox", { name: "Select GEN-2" }))
    await user.click(screen.getByRole("button", { name: "Set priority" }))
    await user.click(screen.getByRole("menuitem", { name: "High" }))

    expect(bulkUpdateIssuePriority).toHaveBeenCalledTimes(1)
    const formData = vi.mocked(bulkUpdateIssuePriority).mock.calls[0][0]
    expect(formData.getAll("id")).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ])
    expect(formData.get("priority")).toBe("high")

    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: "Change priority from High" })
      ).toHaveLength(2)
    })
  })

  it("exposes accessible priority controls and a sortable table column", async () => {
    const { user } = renderIssuesView({
      view: "table",
      data: baseData([
        issue({
          id: "11111111-1111-4111-8111-111111111111",
          title: "Low table issue",
          priority: "low",
        }),
        issue({
          id: "22222222-2222-4222-8222-222222222222",
          title: "Urgent table issue",
          priority: "urgent",
        }),
      ]),
    })

    const table = screen.getByRole("table")
    const priorityHeader = within(table).getByRole("button", {
      name: "Priority",
    })

    expectTextOrder(table, ["Urgent table issue", "Low table issue"])

    await user.click(priorityHeader)

    expectTextOrder(table, ["Low table issue", "Urgent table issue"])
    expect(
      screen.getByRole("button", { name: "Change priority from Low" })
    ).toBeVisible()

    await user.click(
      screen.getByRole("button", { name: "Change priority from Low" })
    )

    const menu = screen.getByRole("menu")
    expect(within(menu).getByRole("menuitem", { name: "Urgent" })).toBeVisible()
    expect(within(menu).getByRole("menuitem", { name: "Low" })).toBeVisible()
  })
})

describe("IssuesView pull request links", () => {
  it.each([
    ["list", false],
    ["table", true],
  ] as const)("shows every pull request in %s view", (view, hasColumn) => {
    renderIssuesView({
      view,
      data: baseData([
        issue({
          id: "11111111-1111-4111-8111-111111111111",
          title: "Issue with pull requests",
          pullRequests: [
            {
              id: "pull-request-1",
              url: "https://github.com/acme/gentic/pull/41",
            },
            {
              id: "pull-request-2",
              url: "https://github.com/acme/gentic/pull/42",
            },
          ],
        }),
      ]),
    })

    expect(
      screen.getByRole("link", { name: "Open acme/gentic#41" })
    ).toHaveAttribute("href", "https://github.com/acme/gentic/pull/41")
    expect(
      screen.getByRole("link", { name: "Open acme/gentic#42" })
    ).toHaveAttribute("href", "https://github.com/acme/gentic/pull/42")

    if (hasColumn) {
      expect(
        screen.getByRole("columnheader", { name: "Pull requests" })
      ).toBeInTheDocument()
    }
  })
})

describe("IssuesView Label discovery", () => {
  const alpha = { id: "label-alpha", name: "Alpha", color: "#2563EB" }
  const beta = { id: "label-beta", name: "Beta", color: "#DC2626" }
  const gamma = { id: "label-gamma", name: "Gamma", color: "#16A34A" }
  const delta = { id: "label-delta", name: "Delta", color: "#9333EA" }

  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    )
  })

  it.each(["list", "table"] as const)(
    "renders three accessible chips and keyboard-accessible overflow in %s view",
    async (view) => {
      const { user } = renderIssuesView({
        view,
        data: baseData([
          issue({
            id: "11111111-1111-4111-8111-111111111111",
            title: "Four Labels",
            labels: [alpha, beta, delta, gamma],
          }),
        ]),
      })

      expect(
        screen.getByRole("button", { name: "Filter by Label Alpha" })
      ).toBeVisible()
      expect(
        screen.getByRole("button", { name: "Filter by Label Beta" })
      ).toBeVisible()
      expect(
        screen.getByRole("button", { name: "Filter by Label Delta" })
      ).toBeVisible()
      expect(
        screen.queryByRole("button", { name: "Filter by Label Gamma" })
      ).not.toBeInTheDocument()

      const overflow = screen.getByLabelText(
        "1 more Labels. All Labels: Alpha, Beta, Delta, Gamma"
      )
      overflow.focus()
      expect(overflow).toHaveFocus()
      await user.hover(overflow)
      expect(await screen.findByRole("tooltip")).toHaveTextContent(
        "Alpha, Beta, Delta, Gamma"
      )
    }
  )

  it.each(["list", "table"] as const)(
    "activates a Label chip without navigation in %s view",
    async (view) => {
      const { user } = renderIssuesView({
        view,
        data: baseData([
          issue({
            id: "11111111-1111-4111-8111-111111111111",
            title: "Alpha issue",
            labels: [alpha],
          }),
          issue({
            id: "22222222-2222-4222-8222-222222222222",
            title: "Unlabeled issue",
          }),
        ]),
      })

      const chip = screen.getByRole("button", {
        name: "Filter by Label Alpha",
      })
      chip.focus()
      await user.keyboard("{Enter}")

      expect(screen.getByText("Alpha issue")).toBeVisible()
      expect(screen.queryByText("Unlabeled issue")).not.toBeInTheDocument()
      expect(
        screen.getByRole("button", { name: "Filter by Label Alpha" })
      ).toHaveAttribute("aria-pressed", "true")
      expect(replace).not.toHaveBeenCalled()
    }
  )

  it("searches Label names and combines Label filters with match-all semantics", async () => {
    const { user } = renderIssuesView({
      data: baseData([
        issue({
          id: "11111111-1111-4111-8111-111111111111",
          title: "Both",
          labels: [alpha, beta],
        }),
        issue({
          id: "22222222-2222-4222-8222-222222222222",
          title: "Alpha only",
          labels: [alpha],
        }),
        issue({
          id: "33333333-3333-4333-8333-333333333333",
          title: "No classification",
        }),
      ]),
    })

    await user.type(screen.getByPlaceholderText("Search issues…"), "bEtA")
    expect(screen.getByText("Both")).toBeVisible()
    expect(screen.queryByText("Alpha only")).not.toBeInTheDocument()

    await user.clear(screen.getByPlaceholderText("Search issues…"))
    await user.click(screen.getByRole("button", { name: "Filters" }))
    await user.click(screen.getByRole("menuitem", { name: "Labels" }))
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Alpha" }))
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Beta" }))

    expect(screen.getByText("Both")).toBeVisible()
    expect(screen.queryByText("Alpha only")).not.toBeInTheDocument()
    expect(screen.queryByText("No classification")).not.toBeInTheDocument()
  })

  it("makes No labels mutually exclusive with specific Labels", async () => {
    const { user } = renderIssuesView({
      data: baseData([
        issue({
          id: "11111111-1111-4111-8111-111111111111",
          title: "Labeled",
          labels: [alpha],
        }),
        issue({
          id: "22222222-2222-4222-8222-222222222222",
          title: "Unlabeled",
        }),
      ]),
    })

    await user.click(screen.getByRole("button", { name: "Filters" }))
    await user.click(screen.getByRole("menuitem", { name: "Labels" }))
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Alpha" }))
    await user.click(
      screen.getByRole("menuitemcheckbox", { name: "No labels" })
    )

    expect(screen.queryByText("Labeled")).not.toBeInTheDocument()
    expect(screen.getByText("Unlabeled")).toBeVisible()
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Alpha" })
    ).toHaveAttribute("data-state", "unchecked")
    expect(
      screen.getByRole("menuitemcheckbox", { name: "No labels" })
    ).toHaveAttribute("data-state", "checked")
  })
})

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("IssuesView new issue dialog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchParams = new URLSearchParams()
    vi.stubGlobal("ResizeObserver", TestResizeObserver)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            projects: [project],
            defaultAgentProvider: "claude_code",
          }),
      })
    )
  })

  it("opens a shadcn dialog instead of navigating to /issues/new", async () => {
    const { user } = renderIssuesView({
      data: baseData([]),
    })

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Create issue" }))

    const dialog = await screen.findByRole("dialog")
    expect(
      within(dialog).getByRole("heading", { name: "New issue" })
    ).toBeVisible()
    expect(
      await within(dialog).findByPlaceholderText(
        "Describe what you want built, fixed, or investigated."
      )
    ).toBeVisible()

    await user.click(within(dialog).getByRole("button", { name: "Close" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
  })
})
