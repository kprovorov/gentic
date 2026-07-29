import assert from "node:assert/strict"
import test from "node:test"

import {
  formatPublishingRequest,
  generateFirstPublishBranchName,
} from "./publish"

test("generateFirstPublishBranchName joins the lowercase issue code and title slug", () => {
  assert.equal(
    generateFirstPublishBranchName({
      projectKey: "FIT",
      issueNumber: 45,
      issueTitle: "Create settings page",
    }),
    "fit-45-create-settings-page"
  )
})

test("generateFirstPublishBranchName truncates using the shared 60-character slug rules", () => {
  const issueTitle =
    "This is a very long issue title that definitely exceeds the sixty character limit we impose on slugs"

  assert.equal(
    generateFirstPublishBranchName({
      projectKey: "FIT",
      issueNumber: 1,
      issueTitle,
    }),
    "fit-1-this-is-a-very-long-issue-title-that-definitely-exceeds-the"
  )
})

test("generateFirstPublishBranchName falls back to 'issue' when the title has no usable slug", () => {
  assert.equal(
    generateFirstPublishBranchName({
      projectKey: "FIT",
      issueNumber: 45,
      issueTitle: "!!! --- ???",
    }),
    "fit-45-issue"
  )
})

test("generateFirstPublishBranchName falls back to 'issue' for a missing title", () => {
  assert.equal(
    generateFirstPublishBranchName({
      projectKey: "FIT",
      issueNumber: 45,
      issueTitle: null,
    }),
    "fit-45-issue"
  )
})

test("formatPublishingRequest is idempotent: identical input renders identical text", () => {
  const input = { branchName: "fit-45-create-settings-page" }

  assert.equal(
    formatPublishingRequest(input),
    formatPublishingRequest({ ...input })
  )
})

test("formatPublishingRequest tells the agent the work is finished and covers publish, commit, and PR rules", () => {
  const message = formatPublishingRequest({
    branchName: "fit-45-create-settings-page",
  })

  assert.match(message, /requested work is finished/i)
  assert.match(message, /`fit-45-create-settings-page`/)
  assert.match(message, /reuse it rather than creating a new one/i)
  assert.match(message, /descriptive conventional commit message/i)
  assert.match(message, /never create an empty commit/i)
  assert.match(message, /push the branch/i)
  assert.match(message, /ready for review — never a draft/i)
  assert.match(message, /commit message as the pull request title/i)
  assert.match(message, /summary section and a test plan section/i)
})

test("formatPublishingRequest without an existing PR tells the agent to avoid duplicating one", () => {
  const message = formatPublishingRequest({
    branchName: "fit-45-create-settings-page",
  })

  assert.match(
    message,
    /if a pull request is already open for this branch, do not open a duplicate — return its url instead/i
  )
})

test("formatPublishingRequest with an existing PR points at it instead of duplicating it", () => {
  const message = formatPublishingRequest({
    branchName: "fit-45-create-settings-page",
    existingPrUrl: "https://github.com/acme/repo/pull/7",
  })

  assert.match(
    message,
    /already recorded for this issue: https:\/\/github\.com\/acme\/repo\/pull\/7/
  )
  assert.match(message, /return its url rather than opening a duplicate/i)
})
