import { afterEach, describe, expect, it, vi } from "vitest"
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

  // iOS pans the page to reveal the focused field; the visual viewport reports
  // that as a scroll of its own.
  panTo(scrollTop: number) {
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

// `layoutHeight` is the height `dvh` and `window.innerHeight` agree on — the
// screen, keyboard or no keyboard, unless the browser resizes the layout
// viewport for one.
function setupViewport(
  options: { height: number; scale?: number } | null,
  { layoutHeight = 800 }: { layoutHeight?: number } = {}
) {
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: layoutHeight,
  })

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

function keyboardInset() {
  return document.documentElement.style.getPropertyValue("--keyboard-inset")
}

function scrolledTo() {
  return document.documentElement.scrollTop
}

afterEach(() => {
  cleanup()
  document.documentElement.style.removeProperty("--keyboard-inset")
  for (const property of ["scrollTop", "scrollHeight", "clientHeight"]) {
    Reflect.deleteProperty(document.documentElement, property)
  }
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

  it("charges nothing for a keyboard the layout viewport already gave up", () => {
    // A browser that honours `interactiveWidget: resizes-content` shrinks the
    // layout viewport itself, and `innerHeight` shrinks with it, so `dvh` has
    // already lost the covered space and there is nothing left to subtract.
    setupViewport({ height: 460 }, { layoutHeight: 460 })

    render(<KeyboardInsetSync />)

    expect(keyboardInset()).toBe("0px")
  })

  it("still reports a keyboard iOS has already taken out of the root's box", () => {
    // iOS shrinks the root element to the visible area while `dvh` keeps its
    // full-screen value, so the composer needs the inset precisely when the
    // root's own height says the keyboard isn't there.
    const viewport = setupViewport({ height: 800 })
    render(<KeyboardInsetSync />)

    setDocument({ clientHeight: 460, scrollHeight: 460 })
    viewport!.resizeTo({ height: 460 })

    expect(keyboardInset()).toBe("340px")
  })

  it("clears the variable on unmount", () => {
    setupViewport({ height: 460 })
    const view = render(<KeyboardInsetSync />)

    view.unmount()

    expect(keyboardInset()).toBe("")
  })

  it("pulls the page back to the top when the keyboard scrolls it away", () => {
    // The issue page is exactly one visible viewport tall, so iOS revealing the
    // composer by scrolling the document only slides the whole thing — composer
    // included — off the top of the screen.
    const viewport = setupViewport({ height: 800 })
    render(<KeyboardInsetSync />)

    viewport!.resizeTo({ height: 460 })
    viewport!.panTo(340)

    expect(scrolledTo()).toBe(0)
  })

  it("pulls the page back to the top as the keyboard opens", () => {
    const viewport = setupViewport({ height: 800 })
    render(<KeyboardInsetSync />)
    setDocument({ scrollTop: 340 })

    viewport!.resizeTo({ height: 460 })

    expect(scrolledTo()).toBe(0)
  })

  it("pulls the page back to the top when the pan reaches the document", () => {
    const viewport = setupViewport({ height: 800 })
    render(<KeyboardInsetSync />)
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
    render(<KeyboardInsetSync />)
    setDocument({ scrollTop: 340, scrollHeight: 4000 })

    viewport!.resizeTo({ height: 460 })

    expect(scrolledTo()).toBe(340)
  })

  it("leaves a pinch-zoomed page where the user panned it", () => {
    const viewport = setupViewport({ height: 800 })
    render(<KeyboardInsetSync />)

    viewport!.resizeTo({ height: 400, scale: 2 })
    viewport!.panTo(120)

    expect(scrolledTo()).toBe(120)
  })

  it("does nothing without the Visual Viewport API", () => {
    setupViewport(null)

    expect(() => render(<KeyboardInsetSync />)).not.toThrow()
    expect(keyboardInset()).toBe("")
  })
})
