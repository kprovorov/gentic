import { useState } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useExpandAnimation } from "./use-expand-animation"

const COLLAPSED_HEIGHT = 320
const EXPANDED_HEIGHT = 700

let animate: ReturnType<typeof vi.fn>
let cancel: ReturnType<typeof vi.fn>
let reducedMotion = false

// jsdom has no layout, so stand in for the class-driven height swap the dialog
// gets from Tailwind: the expanded element simply measures taller.
function stubLayout() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const height = this.classList.contains("expanded")
        ? EXPANDED_HEIGHT
        : COLLAPSED_HEIGHT
      return { height } as DOMRect
    }
  )
}

function Panel() {
  const [expanded, setExpanded] = useState(false)
  const { contentRef, captureHeight } =
    useExpandAnimation<HTMLDivElement>(expanded)

  return (
    <div ref={contentRef} className={expanded ? "expanded" : ""}>
      <button
        type="button"
        onClick={() => {
          captureHeight()
          setExpanded((current) => !current)
        }}
      >
        toggle
      </button>
    </div>
  )
}

function toggle() {
  return userEvent.click(screen.getByRole("button", { name: "toggle" }))
}

function keyframesOf(call: number) {
  return animate.mock.calls[call]?.[0]
}

beforeEach(() => {
  reducedMotion = false
  cancel = vi.fn()
  animate = vi.fn(() => ({ cancel }))
  // jsdom implements neither of these.
  Element.prototype.animate = animate as unknown as Element["animate"]
  window.matchMedia = vi.fn(
    () => ({ matches: reducedMotion }) as MediaQueryList
  )
  stubLayout()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("useExpandAnimation", () => {
  it("does not animate on mount", () => {
    render(<Panel />)

    expect(animate).not.toHaveBeenCalled()
  })

  it("animates from the pre-toggle height up to the expanded height", async () => {
    render(<Panel />)

    await toggle()

    expect(animate).toHaveBeenCalledTimes(1)
    expect(keyframesOf(0)).toEqual([
      { height: `${COLLAPSED_HEIGHT}px` },
      { height: `${EXPANDED_HEIGHT}px` },
    ])
    expect(animate.mock.calls[0]?.[1]).toMatchObject({ duration: 200 })
  })

  it("animates back down when collapsing", async () => {
    render(<Panel />)

    await toggle()
    await toggle()

    expect(animate).toHaveBeenCalledTimes(2)
    expect(keyframesOf(1)).toEqual([
      { height: `${EXPANDED_HEIGHT}px` },
      { height: `${COLLAPSED_HEIGHT}px` },
    ])
  })

  it("cancels the running animation before measuring the next one", async () => {
    render(<Panel />)

    await toggle()
    expect(cancel).not.toHaveBeenCalled()

    await toggle()

    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it("cancels the animation when the panel unmounts", async () => {
    const { unmount } = render(<Panel />)

    await toggle()
    unmount()

    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it("snaps instead of animating when reduced motion is requested", async () => {
    reducedMotion = true
    render(<Panel />)

    await toggle()

    expect(animate).not.toHaveBeenCalled()
  })
})
