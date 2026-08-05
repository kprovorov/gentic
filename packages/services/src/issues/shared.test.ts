import assert from "node:assert/strict"
import test from "node:test"

import {
  getIssueCode,
  parseIssueCode,
  withActiveAssignedLabels,
} from "./shared"

test("getIssueCode joins project key and issue number", () => {
  assert.equal(getIssueCode("FIT", 45), "FIT-45")
})

test("parseIssueCode splits a well-formed Issue Code into key and number", () => {
  assert.deepEqual(parseIssueCode("GEN-123"), {
    projectKey: "GEN",
    issueNumber: 123,
  })
})

test("parseIssueCode normalizes case and surrounding whitespace", () => {
  assert.deepEqual(parseIssueCode("  gen-7 "), {
    projectKey: "GEN",
    issueNumber: 7,
  })
})

test("parseIssueCode rejects malformed Issue Codes", () => {
  for (const code of [
    "",
    "GEN",
    "GEN-",
    "GEN-0",
    "-5",
    "123-4",
    "GE N-1",
    "GEN--1",
  ]) {
    assert.equal(parseIssueCode(code), null, code)
  }
})

test("parseIssueCode round-trips getIssueCode", () => {
  assert.deepEqual(parseIssueCode(getIssueCode("FIT", 45)), {
    projectKey: "FIT",
    issueNumber: 45,
  })
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
