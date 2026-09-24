import assert from "node:assert/strict"
import test from "node:test"

import {
  parseCreateIssueFormData,
  parseUpdateIssueFormData,
} from "./form-values"

const issueId = "8f14e45f-ceea-467e-b7ea-05a3e2b3f4c1"
const projectId = "3f14e45f-ceea-467e-b7ea-05a3e2b3f4c2"

function createFormData(entries: Record<string, string>) {
  const formData = new FormData()
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value)
  }
  return formData
}

test("create issue form parser requires an explicit automatic PR boolean", () => {
  assert.throws(() =>
    parseCreateIssueFormData(
      createFormData({
        project_id: projectId,
        body: "Run the issue.",
      })
    )
  )
})

test("create issue form parser preserves checked automatic PR submission", () => {
  const fields = parseCreateIssueFormData(
    createFormData({
      project_id: projectId,
      body: "Run the issue.",
      create_pr_automatically: "true",
      agent_provider: "codex",
    })
  )

  assert.equal(fields.create_pr_automatically, true)
  assert.equal(fields.agent_provider, "codex")
  assert.equal(fields.issue_model, null)
})

test("create issue form parser preserves unchecked automatic PR submission", () => {
  const fields = parseCreateIssueFormData(
    createFormData({
      project_id: projectId,
      body: "Save a draft.",
      create_pr_automatically: "false",
    })
  )

  assert.equal(fields.create_pr_automatically, false)
})

test("create issue form parser maps the host pill to a pin or the shared queue", () => {
  const hostId = "7f14e45f-ceea-467e-b7ea-05a3e2b3f4c7"
  const pinned = parseCreateIssueFormData(
    createFormData({
      project_id: projectId,
      body: "Run on my laptop.",
      create_pr_automatically: "true",
      pinned_host_id: hostId,
    })
  )
  const anyHost = parseCreateIssueFormData(
    createFormData({
      project_id: projectId,
      body: "Run anywhere.",
      create_pr_automatically: "true",
      pinned_host_id: "",
    })
  )

  assert.equal(pinned.pinned_host_id, hostId)
  assert.equal(anyHost.pinned_host_id, null)
})

test("update issue form parser tells unpinning apart from an omitted host field", () => {
  const hostId = "7f14e45f-ceea-467e-b7ea-05a3e2b3f4c7"
  const base = {
    id: issueId,
    title: "Update the issue.",
    agent_provider: "claude_code",
    type: "feature",
  }

  assert.equal(
    parseUpdateIssueFormData(
      createFormData({ ...base, pinned_host_id: hostId })
    ).pinned_host_id,
    hostId
  )
  assert.equal(
    parseUpdateIssueFormData(createFormData({ ...base, pinned_host_id: "" }))
      .pinned_host_id,
    null
  )
  assert.equal(
    parseUpdateIssueFormData(createFormData(base)).pinned_host_id,
    undefined
  )
})

test("update issue form parser preserves editable automatic PR values", () => {
  const checked = parseUpdateIssueFormData(
    createFormData({
      id: issueId,
      title: "Update the issue.",
      agent_provider: "claude_code",
      type: "feature",
      create_pr_automatically: "true",
    })
  )
  const unchecked = parseUpdateIssueFormData(
    createFormData({
      id: issueId,
      title: "Update the issue.",
      agent_provider: "claude_code",
      type: "feature",
      create_pr_automatically: "false",
    })
  )
  const historical = parseUpdateIssueFormData(
    createFormData({
      id: issueId,
      title: "Update the issue.",
      agent_provider: "claude_code",
      type: "feature",
    })
  )

  assert.equal(checked.create_pr_automatically, true)
  assert.equal(unchecked.create_pr_automatically, false)
  assert.equal(historical.create_pr_automatically, undefined)
})
