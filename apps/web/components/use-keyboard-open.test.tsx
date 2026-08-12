import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { act } from "react"

import { useKeyboardOpen } from "./use-keyboard-open"

class FakeVisualViewport extends EventTarget {
  height: number
  width: number
  scale: number

  constructor({
    height,
    width = 400,
    scale = 1,
  }: {
    height: number
    width?: number
    scale?: number
  }) {
    super()
    this.height = height
    this.width = width
    this.scale = scale
  }

  resizeTo({
    height,
    width = this.width,
    scale = 1,
  }: {
    height: number
    width?: number
    scale?: number
  }) {
    this.height = height
    this.width = width
    this.scale = scale
    act(() => {
      this.dispatchEvent(new Event("resize"))
    })
  }
}

function setupViewport(options: { height: number; width?: number } | null) {
  const viewport = options ? new FakeVisualViewport(options) : null
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    writable: true,
    value: viewport,
  })

  return viewport
}

function Probe() {
  return <span>{useKeyboardOpen() ? "keyboard" : "no keyboard"}</span>
}

function state() {
  return screen.getByText(/keyboard/).textContent
}

// A keyboard is up because a field has focus — the composer, in the case this
// exists for.
function focusField() {
  const field = document.createElement("textarea")
  document.body.append(field)
  field.focus()

  return field
}

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

describe("useKeyboardOpen", () => {
  it("reports a keyboard once one takes a bite out of the visible viewport", () => {
    const viewport = setupViewport({ height: 800 })
    render(<Probe />)
    focusField()
    expect(state()).toBe("no keyboard")

    viewport!.resizeTo({ height: 460 })

    expect(state()).toBe("keyboard")
  })

  it("reports none again once it closes", () => {
    const viewport = setupViewport({ height: 460 })
    render(<Probe />)
    focusField()

    viewport!.resizeTo({ height: 800 })
    viewport!.resizeTo({ height: 460 })
    viewport!.resizeTo({ height: 800 })

    expect(state()).toBe("no keyboard")
  })

  it("catches a keyboard that was already up on the first render", () => {
    // Landing on the page from a screen that had the keyboard open: the first
    // resize is the only evidence that the viewport was ever taller.
    const viewport = setupViewport({ height: 460 })
    render(<Probe />)
    focusField()
    expect(state()).toBe("no keyboard")

    viewport!.resizeTo({ height: 800 })
    viewport!.resizeTo({ height: 460 })

    expect(state()).toBe("keyboard")
  })

  it("ignores browser chrome sliding in and out", () => {
    const viewport = setupViewport({ height: 800 })
    render(<Probe />)
    focusField()

    viewport!.resizeTo({ height: 720 })

    expect(state()).toBe("no keyboard")
  })

  it("ignores a window dragged smaller with nothing to type in", () => {
    // A desktop window losing 340px looks exactly like a keyboard from the
    // viewport's side of the API; only a focused field tells them apart.
    const viewport = setupViewport({ height: 800 })
    render(<Probe />)

    viewport!.resizeTo({ height: 460 })

    expect(state()).toBe("no keyboard")
  })

  it("ignores a viewport shrunk by pinch zoom", () => {
    const viewport = setupViewport({ height: 800 })
    render(<Probe />)
    focusField()

    viewport!.resizeTo({ height: 400, scale: 2 })

    expect(state()).toBe("no keyboard")
  })

  it("starts over when the device rotates", () => {
    // Landscape is genuinely shorter than the portrait height it replaces;
    // holding that against it would report a keyboard that isn't there.
    const viewport = setupViewport({ height: 800, width: 400 })
    render(<Probe />)
    focusField()

    viewport!.resizeTo({ height: 380, width: 800 })

    expect(state()).toBe("no keyboard")
  })

  it("does nothing without the Visual Viewport API", () => {
    setupViewport(null)

    expect(() => render(<Probe />)).not.toThrow()
    expect(state()).toBe("no keyboard")
  })
})
