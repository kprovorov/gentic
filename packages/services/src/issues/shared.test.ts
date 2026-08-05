import assert from "node:assert/strict"
import test from "node:test"

import { getIssueCode, withActiveAssignedLabels } from "./shared"

test("getIssueCode joins project key and issue number", () => {
  assert.equal(getIssueCode("FIT", 45), "FIT-45")
})

test("withActiveAssignedLabels exposes active Labels case-insensitively alphabetically", () => {
  const issue = withActiveAssignedLabels({
    id: "issue-1",
    issue_labels: [
      { labels: { id: "z", name: "zeta", color: "#111111", state: "active" } },
      { labels: { id: "a", name: "Alpha", color: "#222222", state: "active" } },
      {
        labels: {
          id: "x",
          name: "Archived",
          color: "#333333",
          state: "archived",
        },
      },
    ],
  })

  assert.deepEqual(issue, {
    id: "issue-1",
    labels: [
      { id: "a", name: "Alpha", color: "#222222" },
      { id: "z", name: "zeta", color: "#111111" },
    ],
  })
})
