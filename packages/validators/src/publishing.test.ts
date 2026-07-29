import assert from "node:assert/strict"
import test from "node:test"

import {
  formatFirstPullRequestBranchName,
  formatFirstPullRequestPublishingRequest,
  formatPublishingRequest,
} from "./publishing.js"

test("formats first PR branch from issue code and title slug", () => {
  assert.equal(
    formatFirstPullRequestBranchName({
      issueCode: "FIT-45",
      issueTitle: "Create Settings Page",
    }),
    "fit-45-create-settings-page"
  )
})

test("first PR branch reuses existing 60 character title slug rules", () => {
  const branch = formatFirstPullRequestBranchName({
    issueCode: "ABC-123",
    issueTitle:
      "This is a very long issue title that definitely exceeds the sixty character limit we impose on slugs",
  })

  assert.equal(
    branch,
    "abc-123-this-is-a-very-long-issue-title-that-definitely-exceeds-the"
  )
})

test("first PR branch falls back to issue when title has no slug", () => {
  assert.equal(
    formatFirstPullRequestBranchName({
      issueCode: "FIT-45",
      issueTitle: "!!!",
    }),
    "fit-45-issue"
  )
})

test("first PR branch normalizes invalid issue codes", () => {
  assert.equal(
    formatFirstPullRequestBranchName({
      issueCode: " Fit 45 ",
      issueTitle: "Create Settings Page",
    }),
    "fit-45-create-settings-page"
  )
})

test("publishing request is stable and idempotent", () => {
  const request = formatPublishingRequest({
    branchName: "fit-45-create-settings-page",
  })

  assert.equal(
    request,
    formatPublishingRequest({ branchName: "fit-45-create-settings-page" })
  )
  assert.match(request, /The requested work is finished/)
  assert.match(request, /Create or switch to the branch `fit-45-create-settings-page`/)
  assert.match(request, /reuse it/)
  assert.match(request, /descriptive Conventional Commit message/)
  assert.match(request, /ready-for-review pull request/)
  assert.match(request, /default branch/)
  assert.match(request, /Use the commit message as the pull request title/)
  assert.match(request, /Summary and Tests sections/)
  assert.match(request, /Avoid empty commits/)
  assert.match(request, /Return the existing pull request URL/)
  assert.match(request, /explicit visible chat instructions/)
})

test("first PR publishing request derives but does not persist branch names", () => {
  const request = formatFirstPullRequestPublishingRequest({
    issueCode: "FIT-45",
    issueTitle: "Create Settings Page",
  })

  assert.match(request, /`fit-45-create-settings-page`/)
  assert.match(request, /The requested work is finished/)
})
