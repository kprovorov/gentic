"use client"

import { useLayoutEffect, useRef } from "react"

const EXPAND_DURATION_MS = 200
const EXPAND_EASING = "cubic-bezier(0, 0, 0.2, 1)"

// Expanding a panel typically swaps it between its content height and a fixed
// one (85svh for the issue composer), a pair CSS cannot transition between.
// Animate the two measured heights instead, leaving the class-driven height as
// the resting state at both ends.
export function useExpandAnimation<Element extends HTMLElement>(
  expanded: boolean
) {
  const contentRef = useRef<Element>(null)
  const fromHeightRef = useRef<number | null>(null)

  // Toggling has to record the outgoing height here: by the time the layout
  // effect runs, the new size class is already applied and the old height is
  // gone. Call this immediately before flipping `expanded`.
  function captureHeight() {
    fromHeightRef.current =
      contentRef.current?.getBoundingClientRect().height ?? null
  }

  useLayoutEffect(() => {
    const content = contentRef.current
    const from = fromHeightRef.current
    fromHeightRef.current = null

    // Only a toggle records a starting height, so mounting — and any reset of
    // `expanded` while the panel is hidden — never animates.
    if (!content || from === null) return
    if (typeof content.animate !== "function") return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    const to = content.getBoundingClientRect().height
    if (Math.round(from) === Math.round(to)) return

    const animation = content.animate(
      [{ height: `${from}px` }, { height: `${to}px` }],
      { duration: EXPAND_DURATION_MS, easing: EXPAND_EASING }
    )

    // Cancelling from the cleanup rather than the effect body means a toggle
    // that interrupts an animation tears it down before the next one measures
    // its target height.
    return () => animation.cancel()
  }, [expanded])

  return { contentRef, captureHeight }
}
