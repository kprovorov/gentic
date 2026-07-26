import type React from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

// Radix's DropdownMenu relies on PointerEvent capture APIs jsdom doesn't
// implement, so exercising the real menu open/close mechanics here isn't
// worth the flakiness. This stub keeps the item list always rendered and
// lets the tests focus on the agent-switch decision logic wired through
// AgentProviderPicker's onSelect handlers.
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

import { AgentProviderPicker } from "./agent-provider-picker"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("AgentProviderPicker", () => {
  it("does nothing when re-selecting the already-active agent", async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, "confirm")
    const onAgentProviderChange = vi.fn()

    render(
      <AgentProviderPicker
        agentProvider="claude_code"
        hasMessages
        onAgentProviderChange={onAgentProviderChange}
      />
    )

    await user.click(
      screen.getByRole("menuitem", { name: /Claude Code/ })
    )

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(onAgentProviderChange).not.toHaveBeenCalled()
  })

  it("switches freely without confirmation before any messages exist", async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, "confirm")
    const onAgentProviderChange = vi.fn()

    render(
      <AgentProviderPicker
        agentProvider="claude_code"
        hasMessages={false}
        onAgentProviderChange={onAgentProviderChange}
      />
    )

    await user.click(screen.getByRole("menuitem", { name: /Codex/ }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(onAgentProviderChange).toHaveBeenCalledWith("codex", {
      requiresReset: false,
    })
  })

  it("confirms and applies with requiresReset once a conversation exists", async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)
    const onAgentProviderChange = vi.fn()

    render(
      <AgentProviderPicker
        agentProvider="claude_code"
        hasMessages
        onAgentProviderChange={onAgentProviderChange}
      />
    )

    await user.click(screen.getByRole("menuitem", { name: /Codex/ }))

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(onAgentProviderChange).toHaveBeenCalledWith("codex", {
      requiresReset: true,
    })
  })

  it("does not apply the switch when the reset confirmation is cancelled", async () => {
    const user = userEvent.setup()
    vi.spyOn(window, "confirm").mockReturnValue(false)
    const onAgentProviderChange = vi.fn()

    render(
      <AgentProviderPicker
        agentProvider="claude_code"
        hasMessages
        onAgentProviderChange={onAgentProviderChange}
      />
    )

    await user.click(screen.getByRole("menuitem", { name: /Codex/ }))

    expect(onAgentProviderChange).not.toHaveBeenCalled()
  })
})
