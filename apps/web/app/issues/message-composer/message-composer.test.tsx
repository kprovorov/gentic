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
    issueModel: null,
    hasMessages: false,
    onAgentModelChange: vi.fn(),
    ...overrides,
  }
  render(<MessageComposer {...props} />)
  return props
}

function promptField() {
  return screen.getByRole("textbox", { name: "Message the agent" })
}

// The backdrop is decorative, so it carries no role to query it by.
function backdrop() {
  const element = document.querySelector(
    '[data-slot="message-composer-backdrop"]'
  )
  if (!element) {
    throw new Error("composer backdrop not rendered")
  }
  return element
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

    await user.type(promptField(), "h")

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

  it("keeps the attach and send buttons in the collapsed row", () => {
    renderComposer()

    expect(screen.getByRole("button", { name: "Attach files" })).toBeVisible()
    expect(
      screen.getByRole("button", { name: "Send message to agent" })
    ).toBeVisible()
  })

  it("reveals the model picker only once the composer has focus", async () => {
    const user = userEvent.setup()
    renderComposer()

    expect(
      screen.queryByRole("button", { name: "Choose agent and model" })
    ).toBeNull()

    await user.click(promptField())

    expect(
      screen.getByRole("button", { name: "Choose agent and model" })
    ).toBeVisible()
  })

  it("collapses back to the truncated one-line draft when focus leaves", async () => {
    const user = userEvent.setup()
    renderComposer({ draft: "Confirmed: unmanaged path collision" })

    await user.click(promptField())
    await user.click(document.body)

    expect(
      screen.queryByRole("button", { name: "Choose agent and model" })
    ).toBeNull()
    expect(
      screen.getByText("Confirmed: unmanaged path collision", {
        selector: "span",
      })
    ).toHaveClass("truncate")
  })

  it("tints the page behind the composer while it has focus", async () => {
    const user = userEvent.setup()
    renderComposer()

    expect(backdrop()).toHaveClass("opacity-0")

    await user.click(promptField())

    expect(backdrop()).not.toHaveClass("opacity-0")

    await user.click(document.body)

    expect(backdrop()).toHaveClass("opacity-0")
  })

  it("hangs the tint off the body so no ancestor can bound it", () => {
    renderComposer()

    // Rendered in place it would fill whichever ancestor happened to claim it
    // — the app shell rather than the window — leaving the global header
    // untinted.
    expect(backdrop().parentElement).toBe(document.body)
  })

  it("leaves the page untinted for a composer parked open by an attachment", async () => {
    const user = userEvent.setup()
    renderComposer({
      draftFiles: [new File(["diff"], "patch.txt", { type: "text/plain" })],
    })

    await user.click(document.body)

    expect(backdrop()).toHaveClass("opacity-0")
  })

  it("closes the raised composer on Escape", async () => {
    const user = userEvent.setup()
    renderComposer()

    await user.click(promptField())
    await user.keyboard("{Escape}")

    expect(backdrop()).toHaveClass("opacity-0")
    expect(
      screen.queryByRole("button", { name: "Choose agent and model" })
    ).toBeNull()
  })

  it("keeps focus in the draft when the model menu is opened by pointer", async () => {
    const user = userEvent.setup()
    renderComposer()

    await user.click(promptField())
    await user.click(
      screen.getByRole("button", { name: "Choose agent and model" })
    )

    expect(
      await screen.findByRole("menu", { name: "Choose agent and model" })
    ).toBeVisible()
    // Taking focus here is what closes the on-screen keyboard on a phone.
    expect(promptField()).toHaveFocus()
  })

  it("spends Escape on the model menu before the composer itself", async () => {
    const user = userEvent.setup()
    renderComposer()

    await user.click(promptField())
    await user.click(
      screen.getByRole("button", { name: "Choose agent and model" })
    )
    await user.keyboard("{Escape}")

    expect(screen.queryByRole("menu")).toBeNull()
    expect(promptField()).toHaveFocus()
    expect(backdrop()).not.toHaveClass("opacity-0")
  })

  it("leaves Escape to the owner when it handles the key itself", async () => {
    const user = userEvent.setup()
    renderComposer({
      onKeyDown: (event) => event.preventDefault(),
    })

    await user.click(promptField())
    await user.keyboard("{Escape}")

    expect(backdrop()).not.toHaveClass("opacity-0")
  })

  it("stays expanded while a file is attached", async () => {
    const user = userEvent.setup()
    renderComposer({
      draftFiles: [new File(["diff"], "patch.txt", { type: "text/plain" })],
    })

    await user.click(document.body)

    expect(
      screen.getByRole("button", { name: "Choose agent and model" })
    ).toBeVisible()
    expect(screen.getByText("patch.txt")).toBeVisible()
  })

  it("shows the active agent's default label in the picker trigger", async () => {
    const user = userEvent.setup()
    renderComposer({ agentProvider: "codex" })

    await user.click(promptField())

    expect(
      screen.getByRole("button", { name: "Choose agent and model" })
    ).toHaveTextContent("Codex default")
  })

  it("shows the active model in the picker trigger", async () => {
    const user = userEvent.setup()
    renderComposer({ issueModel: "claude-sonnet-5" })

    await user.click(promptField())

    expect(
      screen.getByRole("button", { name: "Choose agent and model" })
    ).toHaveTextContent("Claude Sonnet 5")
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
