import assert from "node:assert/strict"
import { test } from "node:test"

import {
  createIssueSchema,
  defaultIssuePriority,
  hasAttachedIssuePullRequest,
  issuePriorityIcons,
  issuePriorityLabels,
  issuePriorityOptions,
  issuePriorityOrder,
  issuePrioritySchema,
  issuePriorityStyles,
  updateIssuePrioritySchema,
  updateIssueSchema,
} from "./issues.js"

const issueId = "8f14e45f-ceea-467e-b7ea-05a3e2b3f4c1"
const projectId = "3f14e45f-ceea-467e-b7ea-05a3e2b3f4c2"

test("issuePrioritySchema accepts every priority value", () => {
  assert.deepEqual(
    ["low", "medium", "high", "urgent"].map((priority) =>
      issuePrioritySchema.parse(priority)
    ),
    ["low", "medium", "high", "urgent"]
  )
})

test("issue priority defaults to medium on create and update validators", () => {
  const createValues = createIssueSchema.parse({
    project_id: projectId,
    status: "draft",
  })
  const updateValues = updateIssueSchema.parse({
    id: issueId,
    title: "Refine issue workflow",
    agent_provider: "claude_code",
    issue_model: null,
    type: "feature",
  })

  assert.equal(defaultIssuePriority, "medium")
  assert.equal(createValues.priority, "medium")
  assert.equal(createValues.create_pr_automatically, false)
  assert.equal(updateValues.priority, "medium")
})

test("createIssueSchema preserves explicit automatic PR opt-in", () => {
  const createValues = createIssueSchema.parse({
    project_id: projectId,
    status: "draft",
    create_pr_automatically: true,
  })

  assert.equal(createValues.create_pr_automatically, true)
})

test("updateIssueSchema preserves explicit automatic PR edits", () => {
  const updateValues = updateIssueSchema.parse({
    id: issueId,
    title: "Refine issue workflow",
    agent_provider: "claude_code",
    issue_model: null,
    type: "feature",
    create_pr_automatically: false,
  })

  assert.equal(updateValues.create_pr_automatically, false)
})

test("hasAttachedIssuePullRequest detects legacy and tracked PRs", () => {
  assert.equal(
    hasAttachedIssuePullRequest({
      pr_url: null,
      issue_pull_requests: [],
    }),
    false
  )
  assert.equal(
    hasAttachedIssuePullRequest({
      pr_url: "https://github.com/acme/widget/pull/1",
    }),
    true
  )
  assert.equal(
    hasAttachedIssuePullRequest({
      pr_url: null,
      issue_pull_requests: [{ id: "pull-request-1" }],
    }),
    true
  )
})

test("issue priority contract exposes reusable metadata in priority order", () => {
  assert.deepEqual(
    issuePriorityOptions.map((option) => option.value),
    ["low", "medium", "high", "urgent"]
  )
  assert.deepEqual(issuePriorityOrder, {
    low: 0,
    medium: 1,
    high: 2,
    urgent: 3,
  })
  assert.deepEqual(issuePriorityLabels, {
    low: "Low",
    medium: "Medium",
    high: "High",
    urgent: "Urgent",
  })
  assert.deepEqual(issuePriorityIcons, {
    low: "down",
    medium: "minus",
    high: "up",
    urgent: "alert",
  })
  assert.match(issuePriorityStyles.low, /gray/)
  assert.match(issuePriorityStyles.medium, /blue/)
  assert.match(issuePriorityStyles.high, /amber/)
  assert.match(issuePriorityStyles.urgent, /red/)
})

test("updateIssuePrioritySchema accepts focused priority updates", () => {
  assert.deepEqual(
    updateIssuePrioritySchema.parse({
      id: issueId,
      priority: "urgent",
    }),
    {
      id: issueId,
      priority: "urgent",
    }
  )
})

test("issue priority validators reject unknown values", () => {
  assert.throws(() => issuePrioritySchema.parse("normal"))
  assert.throws(() =>
    createIssueSchema.parse({
      project_id: projectId,
      status: "draft",
      priority: "normal",
    })
  )
  assert.throws(() =>
    updateIssuePrioritySchema.parse({
      id: issueId,
      priority: "normal",
    })
  )
})
