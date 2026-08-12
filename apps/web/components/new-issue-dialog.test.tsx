import type React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { fetchNewIssueData } from "@/app/client-queries"

import { NewIssueDialog } from "./new-issue-dialog"
import {
  NewIssueDialogProvider,
  useNewIssueDialog,
} from "./new-issue-dialog-provider"

vi.mock("@/app/client-queries", () => ({
  fetchNewIssueData: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  usePathname: () => "/issues",
}))

vi.mock("@/app/issues/issue-create-form", () => ({
  IssueCreateForm: () => <div data-testid="issue-create-form" />,
}))

function OpenDialogButton() {
  const { openDialog } = useNewIssueDialog()

  return (
    <button type="button" onClick={openDialog}>
      New issue
    </button>
  )
}

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <NewIssueDialogProvider>
        <OpenDialogButton />
        <NewIssueDialog />
      </NewIssueDialogProvider>
    </QueryClientProvider>
  )
}

describe("NewIssueDialog", () => {
  beforeEach(() => {
    vi.mocked(fetchNewIssueData).mockResolvedValue({
      projects: [],
      defaultAgentProvider: "claude_code",
    })
  })

  it("keeps the size toggle styled like the other header icons once expanded", async () => {
    const user = userEvent.setup()
    renderDialog()

    await user.click(screen.getByRole("button", { name: "New issue" }))

    const expand = await screen.findByRole("button", {
      name: "Expand composer",
    })
    // `aria-expanded` is how the ghost button variant paints an *open dropdown
    // trigger* (muted background, full-strength foreground). The composer's
    // size toggle is not a popup trigger, so carrying that attribute would give
    // the collapse icon a background the neighbouring close icon doesn't have.
    expect(expand).not.toHaveAttribute("aria-expanded")

    await user.click(expand)

    const collapse = await screen.findByRole("button", {
      name: "Collapse composer",
    })
    expect(collapse).not.toHaveAttribute("aria-expanded")
    expect(collapse.className).toBe(
      screen.getByRole("button", { name: "Close" }).className
    )
  })
})
