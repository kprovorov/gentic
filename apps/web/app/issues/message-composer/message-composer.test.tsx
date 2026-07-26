import type React from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { MessageComposer } from "./message-composer"

function renderComposer(
  overrides: Partial<React.ComponentProps<typeof MessageComposer>> = {}
) {
  const props: React.ComponentProps<typeof MessageComposer> = {
    draft: "",
    draftFiles: [],
    onDraftChange: vi.fn(),
    onFilesChange: vi.fn(),
    onSubmit: vi.fn((event) => event.preventDefault()),
    agentProvider: "claude_code",
    hasMessages: false,
    onAgentProviderChange: vi.fn(),
    ...overrides,
  }
  render(<MessageComposer {...props} />)
  return props
}

describe("MessageComposer", () => {
  it("disables send until there is a non-empty draft", () => {
    renderComposer({ draft: "  " })

    expect(
      screen.getByRole("button", { name: "Send message to agent" })
    ).toBeDisabled()
  })

  it("reports draft edits through onDraftChange", async () => {
    const user = userEvent.setup()
    const props = renderComposer()

    await user.type(screen.getByPlaceholderText(/Message the agent/), "h")

    expect(props.onDraftChange).toHaveBeenCalledWith("h")
  })

  it("submits the form when send is clicked", async () => {
    const user = userEvent.setup()
    const props = renderComposer({ draft: "Ship it" })

    await user.click(
      screen.getByRole("button", { name: "Send message to agent" })
    )

    expect(props.onSubmit).toHaveBeenCalledTimes(1)
  })

  it("shows the active agent provider in the picker trigger", () => {
    renderComposer({ agentProvider: "codex" })

    expect(
      screen.getByRole("button", { name: "Choose agent" })
    ).toHaveTextContent("Codex")
  })

  it("renders matching slash commands and selects them on click", async () => {
    const user = userEvent.setup()
    const onSelectSlashCommand = vi.fn()
    renderComposer({
      draft: "/pl",
      slashCommands: [{ name: "/plan", description: "Switch to planning" }],
      onSelectSlashCommand,
    })

    await user.click(screen.getByText("/plan"))

    expect(onSelectSlashCommand).toHaveBeenCalledWith({
      name: "/plan",
      description: "Switch to planning",
    })
  })
})
