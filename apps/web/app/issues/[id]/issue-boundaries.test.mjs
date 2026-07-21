import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const routeDir = dirname(fileURLToPath(import.meta.url))

function readRouteFile(name) {
  return readFileSync(join(routeDir, name), "utf8")
}

function startsWithUseClient(source) {
  return source.trimStart().startsWith('"use client"')
}

test("issue detail page and shell remain server-owned", () => {
  const page = readRouteFile("page.tsx")
  const detailView = readRouteFile("issue-detail-view.tsx")

  assert.equal(startsWithUseClient(page), false)
  assert.equal(startsWithUseClient(detailView), false)
  assert.match(page, /await getIssueDetailData\(id\)/)
  assert.match(page, /<IssueDetailView data=\{data\} \/>/)
  assert.doesNotMatch(detailView, /useQuery\(/)
  assert.doesNotMatch(detailView, /getIssueDetailData/)
})

test("issue detail interactive sections are explicit client islands", () => {
  const clientIslandFiles = [
    "issue-chat.tsx",
    "issue-status-controls.tsx",
    "issue-relations.tsx",
    "attachments.tsx",
  ]

  for (const file of clientIslandFiles) {
    assert.equal(startsWithUseClient(readRouteFile(file)), true, file)
  }

  const detailView = readRouteFile("issue-detail-view.tsx")
  assert.match(detailView, /<IssueChat\n\s+issueId=\{issue\.id\}/)
  assert.match(detailView, /<IssueStatusControls\n\s+issueId=\{issue\.id\}/)
  assert.match(detailView, /<IssueRelations\n\s+issueId=\{issue\.id\}/)
  assert.match(detailView, /<Attachments issueId=\{issue\.id\}/)
})

test("message realtime stays inside the chat island", () => {
  const detailView = readRouteFile("issue-detail-view.tsx")
  const issueChat = readRouteFile("issue-chat.tsx")

  assert.match(issueChat, /table: "messages"/)
  assert.doesNotMatch(detailView, /"messages"/)
  assert.doesNotMatch(detailView, /queryKey=\{queryKeys\.issue/)
})

test("retry controls do not serialize the issue prompt", () => {
  const detailView = readRouteFile("issue-detail-view.tsx")
  const retryButton = readRouteFile("issue-retry-agent-button.tsx")

  assert.match(detailView, /<IssueRetryAgentButton issueId=\{issue\.id\} \/>/)
  assert.doesNotMatch(detailView, /issuePrompt/)
  assert.doesNotMatch(retryButton, /issuePrompt/)
})
