import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { act } from "react"

import { VisualViewportSync } from "./visual-viewport-sync"

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

  // iOS pans the page to reveal the focused field; the visual viewport reports
  // that as a scroll of its own, sometimes without a resize.
  panTo(scrollTop: number, { height = this.height } = {}) {
    this.height = height
    setDocument({ scrollTop })
    act(() => {
      this.dispatchEvent(new Event("scroll"))
    })
  }
}

// jsdom has no layout, so the geometry the component measures — the layout
// viewport (`clientHeight`), the content in it, and where it sits — has to be
// stated outright. Unset fields keep whatever the document already had.
function setDocument({
  scrollTop,
  scrollHeight,
  clientHeight,
}: {
  scrollTop?: number
  scrollHeight?: number
  clientHeight?: number
}) {
  const root = document.documentElement
  const next = { scrollTop, scrollHeight, clientHeight }

  for (const [property, value] of Object.entries(next)) {
    if (value === undefined) continue

    Object.defineProperty(root, property, {
      configurable: true,
      writable: true,
      value,
    })
  }
}

function setupViewport(
  options: { height: number; scale?: number } | null,
  { layoutHeight = 800 }: { layoutHeight?: number } = {}
) {
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    writable: true,
    value: vi.fn((_x: number, y: number) => setDocument({ scrollTop: y })),
  })
  // A document exactly as tall as the layout viewport: the shape every screen
  // that pins the composer to the bottom has, and the one with no scroll range.
  setDocument({
    scrollTop: 0,
    scrollHeight: layoutHeight,
    clientHeight: layoutHeight,
  })

  const viewport = options ? new FakeVisualViewport(options) : null
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    writable: true,
    value: viewport,
  })

  return viewport
}

function visualViewportHeight() {
  return document.documentElement.style.getPropertyValue(
    "--visual-viewport-height"
  )
}

function scrolledTo() {
  return document.documentElement.scrollTop
}

afterEach(() => {
  cleanup()
  document.documentElement.style.removeProperty("--visual-viewport-height")
  for (const property of ["scrollTop", "scrollHeight", "clientHeight"]) {
    Reflect.deleteProperty(document.documentElement, property)
  }
})

describe("VisualViewportSync", () => {
  it("publishes the visible height", () => {
    const viewport = setupViewport({ height: 800 })

    render(<VisualViewportSync />)

    expect(visualViewportHeight()).toBe("800px")

    viewport!.resizeTo({ height: 460 })

    expect(visualViewportHeight()).toBe("460px")
  })

  it("publishes the visible height a keyboard left behind, whatever the rest of the page reports", () => {
    // The bug this exists for: on iOS every other height — `dvh`,
    // `window.innerHeight`, the root's `clientHeight` — keeps (or loses) the
    // keyboard's space on its own schedule, so a layout built by subtracting
    // one from another ends up full-screen and hides the composer behind the
    // keyboard. This number comes from the keyboard's own side of the API.
    const viewport = setupViewport({ height: 800 })
    render(<VisualViewportSync />)

    setDocument({ clientHeight: 460 })
    viewport!.resizeTo({ height: 460 })

    expect(visualViewportHeight()).toBe("460px")
  })

  it("follows a keyboard that only reports itself as a scroll", () => {
    const viewport = setupViewport({ height: 800 })
    render(<VisualViewportSync />)

    viewport!.panTo(0, { height: 460 })

    expect(visualViewportHeight()).toBe("460px")
  })

  it("hands a pinch-zoomed page back to `dvh`", () => {
    // Zoomed in, the visual viewport is a window onto the page rather than the
    // room the page has; sizing the shell to it would shrink the app to the
    // magnifying glass.
    const viewport = setupViewport({ height: 800 })
    render(<VisualViewportSync />)
    expect(visualViewportHeight()).toBe("800px")

    viewport!.resizeTo({ height: 400, scale: 2 })

    expect(visualViewportHeight()).toBe("")
  })

  it("clears the variable on unmount", () => {
    setupViewport({ height: 460 })
    const view = render(<VisualViewportSync />)

    view.unmount()

    expect(visualViewportHeight()).toBe("")
  })

  it("pulls the page back to the top when the keyboard scrolls it away", () => {
    // The issue page is exactly one visible viewport tall, so iOS revealing the
    // composer by scrolling the document only slides the whole thing — composer
    // included — off the top of the screen.
    const viewport = setupViewport({ height: 800 })
    render(<VisualViewportSync />)

    viewport!.resizeTo({ height: 460 })
    viewport!.panTo(340)

    expect(scrolledTo()).toBe(0)
  })

  it("pulls the page back to the top as the keyboard opens", () => {
    const viewport = setupViewport({ height: 800 })
    render(<VisualViewportSync />)
    setDocument({ scrollTop: 340 })

    viewport!.resizeTo({ height: 460 })

    expect(scrolledTo()).toBe(0)
  })

  it("pulls the page back to the top when the pan reaches the document", () => {
    const viewport = setupViewport({ height: 800 })
    render(<VisualViewportSync />)
    viewport!.resizeTo({ height: 460 })

    setDocument({ scrollTop: 340 })
    act(() => {
      window.dispatchEvent(new Event("scroll"))
    })

    expect(scrolledTo()).toBe(0)
  })

  it("leaves a page that really scrolls where the browser put it", () => {
    // Here the browser scrolled to reveal a field on a long page; yanking it
    // back to the top would hide what the user is typing in.
    const viewport = setupViewport({ height: 800 })
    render(<VisualViewportSync />)
    setDocument({ scrollTop: 340, scrollHeight: 4000 })

    viewport!.resizeTo({ height: 460 })

    expect(scrolledTo()).toBe(340)
  })

  it("leaves a pinch-zoomed page where the user panned it", () => {
    const viewport = setupViewport({ height: 800 })
    render(<VisualViewportSync />)

    viewport!.resizeTo({ height: 400, scale: 2 })
    viewport!.panTo(120)

    expect(scrolledTo()).toBe(120)
  })

  it("does nothing without the Visual Viewport API", () => {
    setupViewport(null)

    expect(() => render(<VisualViewportSync />)).not.toThrow()
    expect(visualViewportHeight()).toBe("")
  })
})
