import assert from "node:assert/strict"
import { test } from "node:test"

import { formatPullRequestLabel, mergePullRequest } from "./pull-requests"

test("formatPullRequestLabel formats GitHub pull request URLs", () => {
  assert.equal(
    formatPullRequestLabel("https://github.com/acme/widget/pull/42"),
    "acme/widget#42"
  )
})

test("formatPullRequestLabel falls back for malformed URLs", () => {
  assert.equal(formatPullRequestLabel("not a url"), "Pull request")
})

test("mergePullRequest replaces existing PRs and sorts new ones newest first", () => {
  const existing = {
    id: "1",
    issue_id: "issue",
    url: "https://github.com/acme/widget/pull/1",
    created_at: "2026-07-01",
  }
  const newer = {
    id: "2",
    issue_id: "issue",
    url: "https://github.com/acme/widget/pull/2",
    created_at: "2026-07-02",
  }

  assert.deepEqual(
    mergePullRequest([existing], newer).map((pullRequest) => pullRequest.id),
    ["2", "1"]
  )
  assert.equal(
    mergePullRequest([existing], { ...existing, url: newer.url })[0]?.url,
    newer.url
  )
})
