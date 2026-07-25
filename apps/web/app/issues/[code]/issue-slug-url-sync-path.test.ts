import assert from "node:assert/strict"
import { test } from "node:test"

import { getSyncedIssueHref } from "./issue-slug-url-sync-path"

const issue = {
  number: 123,
  title: "Add generated issue slugs",
  projects: {
    key: "WEB",
  },
}

test("syncs issue URL when a title creates a new slug", () => {
  assert.equal(
    getSyncedIssueHref(issue, "/issues/WEB-123"),
    "/issues/WEB-123/add-generated-issue-slugs"
  )
})

test("syncs issue URL when a rename changes the slug", () => {
  assert.equal(
    getSyncedIssueHref(issue, "/issues/WEB-123/old-slug"),
    "/issues/WEB-123/add-generated-issue-slugs"
  )
})

test("does not sync issue URL when the path is already current", () => {
  assert.equal(
    getSyncedIssueHref(issue, "/issues/WEB-123/add-generated-issue-slugs"),
    null
  )
})

test("syncs issue URL back to the code-only path when no slug exists", () => {
  assert.equal(
    getSyncedIssueHref(
      {
        ...issue,
        title: null,
      },
      "/issues/WEB-123/old-slug"
    ),
    "/issues/WEB-123"
  )
})
