import type React from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

// Radix's DropdownMenu relies on PointerEvent capture APIs jsdom doesn't
// implement, so exercising the real menu open/close mechanics here isn't
// worth the flakiness. This stub keeps the item list always rendered and
// lets the tests focus on the agent+model selection logic wired through
// AgentModelPicker's onSelect handlers.
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
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode
    onSelect?: () => void
  }) => (
    <button type="button" role="menuitem" onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
}))

import { AgentModelPicker } from "./agent-model-picker"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("AgentModelPicker", () => {
  it("lists every agent's models, grouped by agent", () => {
    render(
      <AgentModelPicker
        agentProvider="claude_code"
        issueModel={null}
        hasMessages={false}
        onAgentModelChange={vi.fn()}
      />
    )

    expect(
      screen.getByRole("menuitem", { name: /Claude Sonnet 5/ })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("menuitem", { name: /GPT-5\.6 Sol/ })
    ).toBeInTheDocument()
  })

  it("does nothing when re-selecting the already-active agent and model", async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, "confirm")
    const onAgentModelChange = vi.fn()

    render(
      <AgentModelPicker
        agentProvider="claude_code"
        issueModel={null}
        hasMessages
        onAgentModelChange={onAgentModelChange}
      />
    )

    await user.click(
      screen.getByRole("menuitem", { name: /Claude Code default/ })
    )

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(onAgentModelChange).not.toHaveBeenCalled()
  })

  it("switches freely without confirmation before any messages exist", async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, "confirm")
    const onAgentModelChange = vi.fn()

    render(
      <AgentModelPicker
        agentProvider="claude_code"
        issueModel={null}
        hasMessages={false}
        onAgentModelChange={onAgentModelChange}
      />
    )

    await user.click(screen.getByRole("menuitem", { name: /GPT-5\.6 Sol/ }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(onAgentModelChange).toHaveBeenCalledWith("codex", "gpt-5.6-sol", {
      requiresReset: false,
    })
  })

  it("confirms and applies with requiresReset when switching agents once a conversation exists", async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)
    const onAgentModelChange = vi.fn()

    render(
      <AgentModelPicker
        agentProvider="claude_code"
        issueModel={null}
        hasMessages
        onAgentModelChange={onAgentModelChange}
      />
    )

    await user.click(screen.getByRole("menuitem", { name: /GPT-5\.6 Sol/ }))

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(confirmSpy).toHaveBeenCalledWith(
      "Switch to Codex? This resets the conversation and starts a fresh run."
    )
    expect(onAgentModelChange).toHaveBeenCalledWith("codex", "gpt-5.6-sol", {
      requiresReset: true,
    })
  })

  it("confirms with a generic message when only the model changes", async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)
    const onAgentModelChange = vi.fn()

    render(
      <AgentModelPicker
        agentProvider="claude_code"
        issueModel={null}
        hasMessages
        onAgentModelChange={onAgentModelChange}
      />
    )

    await user.click(
      screen.getByRole("menuitem", { name: /Claude Sonnet 5/ })
    )

    expect(confirmSpy).toHaveBeenCalledWith(
      "Switch model? This resets the conversation and starts a fresh run."
    )
    expect(onAgentModelChange).toHaveBeenCalledWith(
      "claude_code",
      "claude-sonnet-5",
      { requiresReset: true }
    )
  })

  it("does not apply the switch when the reset confirmation is cancelled", async () => {
    const user = userEvent.setup()
    vi.spyOn(window, "confirm").mockReturnValue(false)
    const onAgentModelChange = vi.fn()

    render(
      <AgentModelPicker
        agentProvider="claude_code"
        issueModel={null}
        hasMessages
        onAgentModelChange={onAgentModelChange}
      />
    )

    await user.click(screen.getByRole("menuitem", { name: /GPT-5\.6 Sol/ }))

    expect(onAgentModelChange).not.toHaveBeenCalled()
  })
})
