"use client"

import { useEffect } from "react"

// Browser chrome sliding in and out (and pinch-zoom rounding) moves the visual
// viewport by a handful of pixels. Only treat a gap large enough to be a
// keyboard as one, so the layout never twitches under the user.
const MIN_KEYBOARD_INSET_PX = 24

// iOS reports a fractionally-off scale at page zoom.
const MAX_PAGE_SCALE = 1.01

// Publishes the height the on-screen keyboard covers as `--keyboard-inset` on
// <html>, from the Visual Viewport API.
//
// Chrome honours the viewport's `interactiveWidget: resizes-content` and
// shrinks the layout viewport itself, so this stays 0 there and `dvh` already
// does the right thing. iOS Safari ignores that hint: `dvh` keeps counting the
// covered space, which both hides bottom-pinned UI behind the keyboard and
// leaves the page taller than the visible area — exactly the slack that lets
// the whole issue page (composer included) be panned away. Layouts that must
// stay inside the visual viewport subtract this variable.
export function KeyboardInsetSync() {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const root = document.documentElement

    const update = () => {
      // Pinch zoom shrinks the visual viewport too; only a viewport still at
      // page scale is reporting keyboard height.
      const covered =
        viewport.scale > MAX_PAGE_SCALE
          ? 0
          : window.innerHeight - viewport.height

      root.style.setProperty(
        "--keyboard-inset",
        covered >= MIN_KEYBOARD_INSET_PX ? `${Math.round(covered)}px` : "0px"
      )
    }

    update()
    viewport.addEventListener("resize", update)

    return () => {
      viewport.removeEventListener("resize", update)
      root.style.removeProperty("--keyboard-inset")
    }
  }, [])

  return null
}
