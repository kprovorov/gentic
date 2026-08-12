import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { act } from "react"

import { KeyboardInsetSync } from "./keyboard-inset-sync"

class FakeVisualViewport extends EventTarget {
  height: number
  scale: number

  constructor({ height, scale = 1 }: { height: number; scale?: number }) {
    super()
    this.height = height
    this.scale = scale
  }

  resizeTo({ height, scale = 1 }: { height: number; scale?: number }) {
    this.height = height
    this.scale = scale
    act(() => {
      this.dispatchEvent(new Event("resize"))
    })
  }
}

function setupViewport(
  options: { height: number; scale?: number } | null,
  { innerHeight = 800 }: { innerHeight?: number } = {}
) {
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: innerHeight,
  })

  const viewport = options ? new FakeVisualViewport(options) : null
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    writable: true,
    value: viewport,
  })

  return viewport
}

function keyboardInset() {
  return document.documentElement.style.getPropertyValue("--keyboard-inset")
}

afterEach(() => {
  cleanup()
  document.documentElement.style.removeProperty("--keyboard-inset")
})

describe("KeyboardInsetSync", () => {
  it("publishes the height the keyboard covers", () => {
    const viewport = setupViewport({ height: 800 })
    render(<KeyboardInsetSync />)
    expect(keyboardInset()).toBe("0px")

    viewport!.resizeTo({ height: 460 })

    expect(keyboardInset()).toBe("340px")
  })

  it("resets to zero once the keyboard closes", () => {
    const viewport = setupViewport({ height: 460 })
    render(<KeyboardInsetSync />)
    expect(keyboardInset()).toBe("340px")

    viewport!.resizeTo({ height: 800 })

    expect(keyboardInset()).toBe("0px")
  })

  it("ignores gaps too small to be a keyboard", () => {
    // Mobile browser chrome animating in and out moves the visual viewport a
    // few pixels; resizing the layout for that would just look like a twitch.
    setupViewport({ height: 790 })
    render(<KeyboardInsetSync />)

    expect(keyboardInset()).toBe("0px")
  })

  it("ignores a viewport shrunk by pinch zoom", () => {
    setupViewport({ height: 400, scale: 2 })
    render(<KeyboardInsetSync />)

    expect(keyboardInset()).toBe("0px")
  })

  it("clears the variable on unmount", () => {
    setupViewport({ height: 460 })
    const view = render(<KeyboardInsetSync />)

    view.unmount()

    expect(keyboardInset()).toBe("")
  })

  it("does nothing without the Visual Viewport API", () => {
    setupViewport(null)

    expect(() => render(<KeyboardInsetSync />)).not.toThrow()
    expect(keyboardInset()).toBe("")
  })
})
