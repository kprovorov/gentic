import type React from "react"
import { act } from "react"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/app/issues/actions", () => ({
  addIssueRelation: vi.fn(),
  createManualIssuePullRequest: vi.fn(),
  deleteIssue: vi.fn(),
  deleteIssueRelation: vi.fn(),
  resetIssueAgent: vi.fn(),
  updateIssuePriority: vi.fn(),
  updateIssueStatus: vi.fn(),
  updateIssueTitle: vi.fn(),
  updateIssueType: vi.fn(),
  addIssueLabels: vi.fn(),
  removeIssueLabels: vi.fn(),
  startAttachmentUploads: vi.fn(),
  finishAttachmentUploads: vi.fn(),
}))

// The real field fetches the label catalog over the network for its search
// popover, which isn't available in this render-only suite.
vi.mock("@/app/issues/issue-labels-field", () => ({
  IssueLabelsField: () => <div>Labels field</div>,
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

// Radix menus need pointer APIs jsdom lacks, so the menu renders flat here.
// The items still have to act on a click: the actions hanging off them are
// what the tests below exercise.
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
  DropdownMenuItem: ({
    children,
    disabled,
    onSelect,
  }: {
    children: React.ReactNode
    disabled?: boolean
    onSelect?: (event: Event) => void
  }) => (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => onSelect?.(new Event("select"))}
    >
      {children}
    </button>
  ),
}))

import { toast } from "sonner"

import { resetIssueAgent } from "@/app/issues/actions"
import { registerSiteHeaderActionsSlot } from "@/components/site-header-actions-slot"

import { IssueDetailHeader } from "./issue-detail-header"
import { RESET_ISSUE_ERROR_MESSAGE } from "./use-issue-reset"

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
  issue_model: "claude-opus-5",
  has_unpublished_agent_changes: false,
  projects: { key: "GEN", repo: "kprovorov/gentic" },
} as unknown as React.ComponentProps<typeof IssueDetailHeader>["issue"]

function headerTree(
  props: Partial<React.ComponentProps<typeof IssueDetailHeader>> = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false, networkMode: "always" },
    },
  })

  return (
    <QueryClientProvider client={queryClient}>
      <IssueDetailHeader
        issue={issue}
        pullRequests={[]}
        automaticPrPublishingInProgress={false}
        relations={[]}
        relationCandidates={[]}
        labels={[]}
        attachments={[]}
        messageAttachments={[]}
        {...props}
      />
    </QueryClientProvider>
  )
}

function renderHeader(
  props: Partial<React.ComponentProps<typeof IssueDetailHeader>> = {}
) {
  render(headerTree(props))
}

// A keyboard is only up because a field has focus — here the composer, which
// lives below this header rather than in it.
function focusComposer() {
  const composer = document.createElement("textarea")
  document.body.append(composer)
  composer.focus()
}

// The header watches the visible viewport to notice a keyboard; jsdom has no
// such thing, so hand it one that can shrink on cue.
function fakeViewport(height: number) {
  const viewport = Object.assign(new EventTarget(), {
    height,
    width: 400,
    scale: 1,
    resizeTo(next: number) {
      viewport.height = next
      act(() => {
        viewport.dispatchEvent(new Event("resize"))
      })
    },
  })

  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    writable: true,
    value: viewport,
  })

  return viewport
}

const EXPANDED_STORAGE_KEY = "gentic:issue-detail-header-expanded:v1"

// The header's action menu is portalled into the site header rather than
// rendered in place, so without a registered slot it renders nowhere at all.
beforeEach(() => {
  const slot = document.createElement("div")
  document.body.append(slot)
  registerSiteHeaderActionsSlot(slot)
  vi.mocked(resetIssueAgent).mockResolvedValue({
    message: {
      id: "33333333-3333-4333-8333-333333333333",
      role: "user",
      kind: "text",
      content: "Work on GEN-1.",
      status: "complete",
      author_type: "gentic",
      generated_action: null,
      created_at: "2026-07-14T00:00:00.000Z",
    },
    discardedRunIds: [],
  })
})

afterEach(() => {
  registerSiteHeaderActionsSlot(null)
  vi.restoreAllMocks()
  vi.clearAllMocks()
  window.localStorage.clear()
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

  it("folds the details away when the keyboard opens", () => {
    // The details, the timeline and the composer don't all fit in what a
    // keyboard leaves of a phone screen, and this header doesn't shrink, so an
    // expanded one pushes the composer off the bottom just as it's needed.
    const viewport = fakeViewport(800)
    renderHeader()
    expect(screen.getByText(issue.body as string)).toBeVisible()

    focusComposer()
    viewport.resizeTo(460)

    expect(screen.queryByText(issue.body as string)).not.toBeInTheDocument()
  })

  // Whether the details are folded away is a reading preference, so it has to
  // outlive the issue the user set it on.
  it("opens collapsed when the details were last hidden", () => {
    window.localStorage.setItem(EXPANDED_STORAGE_KEY, "false")

    renderHeader()

    expect(screen.queryByText(issue.body as string)).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Show issue details" })
    ).toBeVisible()
  })

  // The page is server rendered, so the stored preference reaches the header
  // through a client-only store rather than the initial state — seeding the
  // state from localStorage would make the first client render disagree with
  // the markup being hydrated and blow the whole tree away.
  it("restores a stored collapse without a hydration mismatch", () => {
    const container = document.createElement("div")
    document.body.append(container)
    container.innerHTML = renderToString(headerTree())
    expect(container.textContent).toContain(issue.body as string)

    // React only surfaces a mismatch here — it recovers by re-rendering the
    // whole tree on the client, so the DOM alone would look fine either way.
    const recoverableErrors: unknown[] = []
    window.localStorage.setItem(EXPANDED_STORAGE_KEY, "false")
    let root!: ReturnType<typeof hydrateRoot>
    act(() => {
      root = hydrateRoot(container, headerTree(), {
        onRecoverableError: (error) => recoverableErrors.push(error),
      })
    })

    expect(recoverableErrors).toEqual([])
    expect(container.textContent).not.toContain(issue.body as string)

    act(() => root.unmount())
    container.remove()
  })

  it("remembers each toggle of the details", async () => {
    const user = userEvent.setup()
    renderHeader()

    await user.click(screen.getByRole("button", { name: "Hide issue details" }))
    expect(window.localStorage.getItem(EXPANDED_STORAGE_KEY)).toBe("false")

    await user.click(screen.getByRole("button", { name: "Show issue details" }))
    expect(window.localStorage.getItem(EXPANDED_STORAGE_KEY)).toBe("true")
  })

  it("doesn't remember the fold the keyboard forced", () => {
    // The keyboard fold is the screen making room, not a choice — storing it
    // would leave every later issue collapsed after a single reply.
    const viewport = fakeViewport(800)
    renderHeader()

    focusComposer()
    viewport.resizeTo(460)

    expect(window.localStorage.getItem(EXPANDED_STORAGE_KEY)).toBeNull()
  })

  it("resets the issue on the agent and model it is already set to", async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true)
    renderHeader()

    await user.click(screen.getByRole("menuitem", { name: "Reset" }))

    expect(confirm).toHaveBeenCalledOnce()
    await waitFor(() => expect(resetIssueAgent).toHaveBeenCalledOnce())
    const formData = vi.mocked(resetIssueAgent).mock.calls[0][0]
    expect(formData.get("id")).toBe(issue.id)
    expect(formData.get("agent_provider")).toBe("claude_code")
    expect(formData.get("issue_model")).toBe("claude-opus-5")
  })

  // The reset deletes the conversation and the pull-request links, so a
  // dismissed confirmation has to leave the issue untouched.
  it("leaves the issue alone when the reset confirmation is dismissed", async () => {
    const user = userEvent.setup()
    vi.spyOn(window, "confirm").mockReturnValue(false)
    renderHeader()

    await user.click(screen.getByRole("menuitem", { name: "Reset" }))

    expect(resetIssueAgent).not.toHaveBeenCalled()
  })

  // A reset that fails changes nothing on screen, so without a message the
  // user is left staring at a confirmed dialog that apparently did nothing.
  it("says so when the reset is rejected", async () => {
    const user = userEvent.setup()
    vi.spyOn(window, "confirm").mockReturnValue(true)
    vi.mocked(resetIssueAgent).mockRejectedValue(new Error("Issue not found"))
    renderHeader()

    await user.click(screen.getByRole("menuitem", { name: "Reset" }))

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(RESET_ISSUE_ERROR_MESSAGE)
    )
  })

  it("offers no reset before the issue has left draft", () => {
    renderHeader({ issue: { ...issue, status: "draft" } })

    expect(
      screen.queryByRole("menuitem", { name: "Reset" })
    ).not.toBeInTheDocument()
  })

  it("offers no reset on a Spec, which never runs an agent", () => {
    renderHeader({ issue: { ...issue, type: "spec" } })

    expect(
      screen.queryByRole("menuitem", { name: "Reset" })
    ).not.toBeInTheDocument()
  })

  it("lets the details back open with the keyboard still up", async () => {
    const user = userEvent.setup()
    const viewport = fakeViewport(800)
    renderHeader()

    focusComposer()
    viewport.resizeTo(460)
    await user.click(screen.getByRole("button", { name: "Show issue details" }))

    expect(screen.getByText(issue.body as string)).toBeVisible()
  })
})
