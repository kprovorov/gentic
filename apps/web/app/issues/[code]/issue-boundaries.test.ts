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
  assert.match(detailView, /<IssueDetailHeader issue=\{issue\} \/>/)
  assert.match(detailView, /<IssueDetailTimelinePanel\n\s+issueId=\{issue\.id\}/)
  assert.match(detailView, /<IssueDetailRail\n\s+issueId=\{issue\.id\}/)
  assert.match(
    detailView,
    /<IssueSlugUrlSync key=\{issue\.title \?\? ""\} issue=\{issue\} \/>/
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

test("the issue prompt is only serialized into the timeline island", () => {
  const header = readRouteFile("issue-detail-header.tsx")
  const rail = readRouteFile("issue-detail-rail.tsx")
  const retryButton = readRouteFile("issue-retry-agent-button.tsx")
  const timelinePanel = readRouteFile("issue-detail-timeline-panel.tsx")

  assert.match(timelinePanel, /issuePrompt/)
  assert.doesNotMatch(header, /issuePrompt/)
  assert.doesNotMatch(rail, /issuePrompt/)
  assert.doesNotMatch(retryButton, /issuePrompt/)
})
