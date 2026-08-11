import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const routeDir = dirname(fileURLToPath(import.meta.url))

function readRouteFile(name: string) {
  return readFileSync(join(routeDir, name), "utf8")
}

function readDetailRouteFile(name: string) {
  return readFileSync(join(routeDir, "[[...slug]]", name), "utf8")
}

function startsWithUseClient(source: string) {
  return source.trimStart().startsWith('"use client"')
}

test("issue detail page and shell remain server-owned", () => {
  const page = readDetailRouteFile("page.tsx")
  const detailView = readRouteFile("issue-detail-view.tsx")

  assert.equal(startsWithUseClient(page), false)
  assert.equal(startsWithUseClient(detailView), false)
  assert.match(page, /await getIssueDetailData\(/)
  assert.match(page, /parseIssueCode\(code\)/)
  assert.match(page, /redirect\(canonicalHref\)/)
  assert.match(page, /<IssueDetailView data=\{data\} \/>/)
  assert.doesNotMatch(detailView, /useQuery\(/)
  assert.doesNotMatch(detailView, /getIssueDetailData/)
})

test("issue detail interactive sections are explicit client islands", () => {
  const clientIslandFiles = [
    "issue-detail-header.tsx",
    "issue-detail-timeline-panel.tsx",
    "issue-detail-rail.tsx",
    "issue-slug-url-sync.tsx",
  ]

  for (const file of clientIslandFiles) {
    assert.equal(startsWithUseClient(readRouteFile(file)), true, file)
  }

  const detailView = readRouteFile("issue-detail-view.tsx")
  assert.match(detailView, /<IssueDetailHeader\n\s+issue=\{issue\}/)
  assert.match(detailView, /<IssueDetailTimelinePanel\n\s+issueId=\{issue\.id\}/)
  assert.match(detailView, /<IssueDetailRail\n\s+issueId=\{issue\.id\}/)
  assert.match(
    detailView,
    /<IssueSlugUrlSync issue=\{issue\} \/>/
  )
})

test("message realtime stays inside the timeline island", () => {
  const detailView = readRouteFile("issue-detail-view.tsx")
  const timelinePanel = readRouteFile("issue-detail-timeline-panel.tsx")
  const issueChatState = readFileSync(
    join(routeDir, "issue-chat", "use-issue-chat-state.ts"),
    "utf8"
  )

  assert.match(timelinePanel, /issue-chat\/use-issue-chat-state/)
  assert.match(issueChatState, /REALTIME_MESSAGE_EVENT/)
  assert.doesNotMatch(detailView, /"messages"/)
  assert.doesNotMatch(detailView, /queryKey=\{queryKeys\.issue/)
})

test("the issue body is only serialized into the timeline island", () => {
  const header = readRouteFile("issue-detail-header.tsx")
  const rail = readRouteFile("issue-detail-rail.tsx")
  const timelinePanel = readRouteFile("issue-detail-timeline-panel.tsx")

  assert.match(timelinePanel, /issueBody/)
  assert.doesNotMatch(header, /issueBody/)
  assert.doesNotMatch(rail, /issueBody/)
})

test("the timeline scroller follows new messages in its internal viewport", () => {
  const timelinePanel = readRouteFile("issue-detail-timeline-panel.tsx")

  assert.match(timelinePanel, /<MessageScrollerProvider autoScroll>/)
  assert.match(timelinePanel, /<MessageScroller className="min-w-0 flex-1">/)
})

test("the detail view owns the viewport height so the composer pins to the bottom", () => {
  const detailView = readRouteFile("issue-detail-view.tsx")
  const timelinePanel = readRouteFile("issue-detail-timeline-panel.tsx")

  // The view is exactly one viewport tall at every breakpoint (`dvh` so
  // mobile browser chrome and the keyboard are accounted for), and the panel
  // fills it rather than guessing its own height — otherwise the page scrolls
  // and the composer floats above the bottom of the screen on mobile.
  assert.match(detailView, /h-\[calc\(100dvh-3\.5rem\)\]/)
  assert.match(detailView, /overflow-hidden/)
  assert.doesNotMatch(timelinePanel, /100[sdl]vh/)
  assert.match(
    timelinePanel,
    /<div className="flex min-h-0 min-w-0 flex-1 flex-col">/
  )
})
