"use client"

import { useEffect } from "react"

// Browser chrome sliding in and out (and pinch-zoom rounding) moves the visual
// viewport by a handful of pixels. Only treat a gap large enough to be a
// keyboard as one, so the layout never twitches under the user.
const MIN_KEYBOARD_INSET_PX = 24

// iOS reports a fractionally-off scale at page zoom.
const MAX_PAGE_SCALE = 1.01

// Sub-pixel layout rounding can leave a hair of overflow on a page that has
// nothing to scroll; anything larger is a page the user can really scroll.
const SCROLL_SLACK_PX = 1

// Publishes the height the on-screen keyboard covers as `--keyboard-inset` on
// <html>, from the Visual Viewport API, and pulls a document that has nothing
// to scroll back to the top.
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

    // iOS Safari reveals the focused field by scrolling the *document*, and it
    // measures against the full-height layout viewport it still reports while
    // the keyboard is up — so it happily scrolls a page that has no scroll
    // range at all. Shrinking the shell by the inset above puts the composer
    // back inside the visible area, but that stolen offset survives, which is
    // how tapping the issue composer slides the whole page off the top of the
    // screen. A document with nothing to scroll belongs at the top; put it
    // back, and leave a page that genuinely scrolls exactly where the browser
    // (or the user) left it.
    const restoreScrollTop = () => {
      // A pinch-zoomed viewport is panned by the user, not the keyboard.
      if (viewport.scale > MAX_PAGE_SCALE) return

      const scroller = document.scrollingElement ?? root
      if (scroller.scrollHeight - scroller.clientHeight > SCROLL_SLACK_PX) {
        return
      }
      if (scroller.scrollTop === 0) return

      window.scrollTo(window.scrollX, 0)
    }

    const update = () => {
      // `window.innerHeight`, not the root's client height: iOS shrinks the
      // root's box to the visible area once the keyboard is up while `dvh`
      // keeps its full-screen value, so measuring against it reports no
      // keyboard at all and drops the composer behind one. `innerHeight` is
      // the height `dvh` agrees with.
      //
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

      // Reading the scroll geometry here flushes the layout the property above
      // just invalidated, so this measures the already-shrunk shell.
      restoreScrollTop()
    }

    update()
    viewport.addEventListener("resize", update)
    // The keyboard's scroll lands after — and sometimes without — the resize
    // that opened it, and reaches either viewport depending on how far the
    // browser thinks it can pan.
    viewport.addEventListener("scroll", restoreScrollTop)
    window.addEventListener("scroll", restoreScrollTop, { passive: true })

    return () => {
      viewport.removeEventListener("resize", update)
      viewport.removeEventListener("scroll", restoreScrollTop)
      window.removeEventListener("scroll", restoreScrollTop)
      root.style.removeProperty("--keyboard-inset")
    }
  }, [])

  return null
}
