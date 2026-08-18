"use client"

import { useLayoutEffect, useRef } from "react"

const EXPAND_DURATION_MS = 200
const EXPAND_EASING = "cubic-bezier(0, 0, 0.2, 1)"

// Expanding a panel swaps it between two shapes CSS cannot transition between:
// a content height and a fixed one (85svh for the issue composer), or two
// reflows of the same row (the chat composer's pill and box). Animate the two
// measured heights instead, leaving the class-driven height as the resting
// state at both ends.
export function useExpandAnimation<Element extends HTMLElement>(
  expanded: boolean
) {
  const contentRef = useRef<Element>(null)
  const fromHeightRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    const content = contentRef.current
    const from = fromHeightRef.current

    // The outgoing height is gone by the time this runs — the new shape is
    // already in the DOM — so it comes from the effect below, which leaves
    // every committed height behind for the next toggle. Nothing is recorded
    // before the first commit, so mounting never animates.
    if (!content || from === null) return
    if (typeof content.animate !== "function") return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    const to = content.getBoundingClientRect().height
    if (Math.round(from) === Math.round(to)) return

    // Layout is already in the shape the animation is heading for, so the box
    // spends the ride smaller than what it holds; clipping makes it reveal the
    // new shape rather than spill it.
    const restingOverflow = content.style.overflow
    content.style.overflow = "hidden"

    const animation = content.animate(
      [{ height: `${from}px` }, { height: `${to}px` }],
      { duration: EXPAND_DURATION_MS, easing: EXPAND_EASING }
    )
    let finished = false
    animation.onfinish = () => {
      finished = true
      content.style.overflow = restingOverflow
      fromHeightRef.current = to
    }

    // Cancelling from the cleanup rather than the effect body means a toggle
    // that interrupts an animation tears it down before the next one measures
    // its target height — and hands over the height it had reached, so the
    // next one carries on from there instead of jumping back. Once it has
    // finished it owns the height no longer, and the element measures as the
    // shape this toggle just gave it, so `onfinish` records the height instead.
    return () => {
      if (!finished) {
        fromHeightRef.current = content.getBoundingClientRect().height
      }

      content.style.overflow = restingOverflow
      animation.cancel()
    }
  }, [expanded])

  // Runs after every commit, animating or not, so a toggle always finds the
  // height of the shape it is leaving. The value it leaves behind mid-animation
  // is stale, but the cleanup above replaces it with the live one before a
  // toggle can read it.
  useLayoutEffect(() => {
    const content = contentRef.current
    if (content) {
      fromHeightRef.current = content.getBoundingClientRect().height
    }
  })

  return contentRef
}
