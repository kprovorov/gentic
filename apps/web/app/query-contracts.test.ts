import assert from "node:assert/strict"
import test from "node:test"

import {
  homeIssueSchema,
  issueDetailSchema,
  issueEditSchema,
  toHomeIssue,
  toIssueDetail,
  toIssueEdit,
} from "./query-contracts"

const issueRow = {
  id: "8f14e45f-ceea-467e-b7ea-05a3e2b3f4c1",
  number: 7,
  title: "Propagate priority",
  prompt: "Keep priority in web queries.",
  status: "todo",
  type: "feature",
  priority: "urgent",
  agent_provider: "codex",
  issue_model: "gpt-5.6",
  usage_limit_reset_at: null,
  run_started_at: null,
  pr_url: null,
  create_pr_automatically: true,
  issue_pull_requests: [],
  created_at: "2026-07-29T12:00:00.000Z",
  updated_at: "2026-07-29T12:05:00.000Z",
  projects: {
    id: "3f14e45f-ceea-467e-b7ea-05a3e2b3f4c2",
    name: "Gentic",
    repo: "acme/gentic",
    key: "GEN",
  },
}

test("home issue query contract parses and maps priority", () => {
  const issue = toHomeIssue(homeIssueSchema.parse(issueRow))

  assert.equal(issue.priority, "urgent")
  assert.equal(issue.code, "GEN-7")
})

test("detail issue query contract parses and maps priority", () => {
  const issue = toIssueDetail(issueDetailSchema.parse(issueRow))

  assert.equal(issue.priority, "urgent")
  assert.equal(issue.code, "GEN-7")
})

test("edit issue query contract parses and maps priority", () => {
  const issue = toIssueEdit(issueEditSchema.parse(issueRow))

  assert.equal(issue.priority, "urgent")
  assert.equal(issue.create_pr_automatically, true)
  assert.equal(issue.has_attached_pull_request, false)
  assert.equal(issue.code, "GEN-7")
})

test("edit issue query contract marks attached pull requests as historical", () => {
  const legacyIssue = toIssueEdit(
    issueEditSchema.parse({
      ...issueRow,
      pr_url: "https://github.com/acme/gentic/pull/1",
    })
  )
  const attachedIssue = toIssueEdit(
    issueEditSchema.parse({
      ...issueRow,
      pr_url: null,
      issue_pull_requests: [{ id: "pull-request-1" }],
    })
  )

  assert.equal(legacyIssue.has_attached_pull_request, true)
  assert.equal(attachedIssue.has_attached_pull_request, true)
})

test("issue query contracts reject missing priority", () => {
  const missingPriority = { ...issueRow, priority: undefined }

  assert.throws(() => homeIssueSchema.parse(missingPriority))
  assert.throws(() => issueDetailSchema.parse(missingPriority))
  assert.throws(() => issueEditSchema.parse(missingPriority))
})
