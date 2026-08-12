"use client"

import { useEffect, useState } from "react"

// Browser chrome sliding in and out moves the visible viewport by a fraction
// of what a keyboard covers, so only a bite this large counts as one.
const MIN_KEYBOARD_COVERAGE_PX = 150

// iOS reports a fractionally-off scale at page zoom.
const MAX_PAGE_SCALE = 1.01

// A keyboard is only ever up because something editable has focus, which is
// what tells a keyboard apart from a browser window being dragged smaller.
function isEditable(element: Element | null) {
  return (
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLInputElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  )
}

// Whether the on-screen keyboard is currently covering the window.
//
// No height stays at full screen on iOS while a keyboard is up — that is the
// whole story in `VisualViewportSync` — so there is nothing to subtract the
// visible height from. Compare it against the tallest the visible viewport has
// been on this screen instead: on a phone, the keyboard is the only thing that
// takes a bite that big out of it.
export function useKeyboardOpen() {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    let tallest = viewport.height
    let width = viewport.width

    const update = () => {
      // Pinch zoom shrinks the visible viewport without a keyboard in sight.
      if (viewport.scale > MAX_PAGE_SCALE) return

      // A rotation makes the tallest height so far meaningless.
      if (viewport.width !== width) {
        width = viewport.width
        tallest = viewport.height
      }

      tallest = Math.max(tallest, viewport.height)
      setIsOpen(
        tallest - viewport.height >= MIN_KEYBOARD_COVERAGE_PX &&
          isEditable(document.activeElement)
      )
    }

    update()
    viewport.addEventListener("resize", update)
    viewport.addEventListener("scroll", update)

    return () => {
      viewport.removeEventListener("resize", update)
      viewport.removeEventListener("scroll", update)
    }
  }, [])

  return isOpen
}
