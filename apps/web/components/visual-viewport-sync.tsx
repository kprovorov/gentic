"use client"

import { useEffect } from "react"

// iOS reports a fractionally-off scale at page zoom.
const MAX_PAGE_SCALE = 1.01

// Sub-pixel layout rounding can leave a hair of overflow on a page that has
// nothing to scroll; anything larger is a page the user can really scroll.
const SCROLL_SLACK_PX = 1

// Publishes the height of the *visible* viewport as `--visual-viewport-height`
// on <html>, and pulls a document that has nothing to scroll back to the top.
//
// Screens that pin something to the bottom of the window — the issue page, so
// its message composer sits above the keyboard — size themselves from this
// variable, falling back to `dvh` until it lands.
//
// The obvious alternative, subtracting a measured keyboard height from `dvh`,
// does not survive contact with iOS: with the keyboard up, `dvh` keeps its
// full-screen value while every JavaScript height that could be subtracted
// from it — `window.innerHeight`, the root element's `clientHeight` — shrinks
// to the visible area. Every candidate difference is therefore zero, the
// layout keeps its full-screen height, and the composer ends up behind the
// keyboard. The visible height itself is the one number the browsers agree on,
// so use it directly and never mention the keyboard at all.
export function VisualViewportSync() {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return

    const root = document.documentElement

    // iOS reveals the focused field by scrolling the document, measured
    // against a layout viewport that is taller than the visible area, so it
    // scrolls pages that have no scroll range at all — which is how tapping
    // the composer slid the whole issue page off the top of the screen. A
    // document with nothing to scroll belongs at the top; put it back, and
    // leave a page that genuinely scrolls where the browser or the user left
    // it.
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
      // Pinch zoom makes the visual viewport a window onto the page rather
      // than the room the page has; leave those layouts on `dvh`.
      if (viewport.scale > MAX_PAGE_SCALE) {
        root.style.removeProperty("--visual-viewport-height")
      } else {
        root.style.setProperty(
          "--visual-viewport-height",
          `${Math.round(viewport.height)}px`
        )
      }

      restoreScrollTop()
    }

    update()
    // A keyboard opening is a resize, but iOS also reports it — sometimes only
    // it — as the visual viewport scrolling within the layout viewport.
    viewport.addEventListener("resize", update)
    viewport.addEventListener("scroll", update)
    window.addEventListener("scroll", restoreScrollTop, { passive: true })

    return () => {
      viewport.removeEventListener("resize", update)
      viewport.removeEventListener("scroll", update)
      window.removeEventListener("scroll", restoreScrollTop)
      root.style.removeProperty("--visual-viewport-height")
    }
  }, [])

  return null
}
