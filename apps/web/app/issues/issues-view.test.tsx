import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { HomeIssue, IssuesData } from "@/app/queries"

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
    projects: project,
    ...overrides,
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
        <IssuesView initialData={data} />
      </QueryClientProvider>
    ),
  }
}

function baseData(issues: HomeIssue[]): IssuesData {
  return {
    issues,
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

    await user.click(screen.getByRole("button", { name: /^Priority$/ }))
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Urgent" }))
    await user.click(screen.getByRole("menuitemcheckbox", { name: "High" }))

    expect(screen.getByRole("menu", { name: "Priority2" })).toBeVisible()
    expect(screen.getByText("Urgent issue")).toBeVisible()
    expect(screen.getByText("High issue")).toBeVisible()
    expect(screen.queryByText("Low issue")).not.toBeInTheDocument()

    await user.click(screen.getByRole("menuitem", { name: "Clear filter" }))

    expect(screen.getByText("Low issue")).toBeVisible()
    expect(screen.getByRole("button", { name: /^Priority$/ })).toBeVisible()
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
          title: "Table issue",
          priority: "medium",
        }),
      ]),
    })

    expect(screen.getAllByRole("button", { name: "Priority" })[1]).toBeVisible()
    expect(
      screen.getByRole("button", { name: "Change priority from Medium" })
    ).toBeVisible()

    await user.click(
      screen.getByRole("button", { name: "Change priority from Medium" })
    )

    const menu = screen.getByRole("menu")
    expect(within(menu).getByRole("menuitem", { name: "Urgent" })).toBeVisible()
    expect(within(menu).getByRole("menuitem", { name: "Low" })).toBeVisible()
  })
})
