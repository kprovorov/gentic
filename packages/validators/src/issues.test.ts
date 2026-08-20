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
  issueTypeSchema,
  isSpecIssueType,
  mutateIssueLabelsSchema,
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

test("createIssueSchema defaults label_ids to an empty array", () => {
  const createValues = createIssueSchema.parse({
    project_id: projectId,
    status: "draft",
  })

  assert.deepEqual(createValues.label_ids, [])
})

test("createIssueSchema dedupes repeated label_ids", () => {
  const labelId = "5f14e45f-ceea-467e-b7ea-05a3e2b3f4c3"
  const createValues = createIssueSchema.parse({
    project_id: projectId,
    status: "draft",
    label_ids: [labelId, labelId],
  })

  assert.deepEqual(createValues.label_ids, [labelId])
})

test("createIssueSchema rejects more than 20 unique label_ids", () => {
  const labelIds = Array.from(
    { length: 21 },
    (_, index) => `6f14e45f-ceea-467e-b7ea-05a3e2b3${index.toString().padStart(4, "0")}`
  )

  assert.throws(() =>
    createIssueSchema.parse({
      project_id: projectId,
      status: "draft",
      label_ids: labelIds,
    })
  )
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

test("updateIssueSchema leaves automatic_review_enabled untouched when omitted", () => {
  const updateValues = updateIssueSchema.parse({
    id: issueId,
    title: "Refine issue workflow",
    agent_provider: "claude_code",
    issue_model: null,
    type: "feature",
  })

  assert.equal(updateValues.automatic_review_enabled, undefined)
})

test("updateIssueSchema accepts an explicit automatic_review_enabled override or null to inherit", () => {
  const enabled = updateIssueSchema.parse({
    id: issueId,
    title: "Refine issue workflow",
    agent_provider: "claude_code",
    issue_model: null,
    type: "feature",
    automatic_review_enabled: true,
  })
  const inherited = updateIssueSchema.parse({
    id: issueId,
    title: "Refine issue workflow",
    agent_provider: "claude_code",
    issue_model: null,
    type: "feature",
    automatic_review_enabled: null,
  })

  assert.equal(enabled.automatic_review_enabled, true)
  assert.equal(inherited.automatic_review_enabled, null)
})

test("hasAttachedIssuePullRequest detects associated PRs", () => {
  assert.equal(
    hasAttachedIssuePullRequest({
      issue_pull_requests: [],
    }),
    false
  )
  assert.equal(
    hasAttachedIssuePullRequest({
      issue_pull_requests: undefined,
    }),
    false
  )
  assert.equal(
    hasAttachedIssuePullRequest({
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
  assert.match(issuePriorityStyles.low, /bg-muted/)
  assert.match(issuePriorityStyles.medium, /bg-muted/)
  assert.match(issuePriorityStyles.high, /bg-muted/)
  assert.match(issuePriorityStyles.urgent, /bg-muted/)
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

test("mutateIssueLabelsSchema dedupes issue_ids and label_ids", () => {
  const labelId = "5f14e45f-ceea-467e-b7ea-05a3e2b3f4c3"
  const values = mutateIssueLabelsSchema.parse({
    issue_ids: [issueId, issueId],
    label_ids: [labelId, labelId],
  })

  assert.deepEqual(values.issue_ids, [issueId])
  assert.deepEqual(values.label_ids, [labelId])
})

test("mutateIssueLabelsSchema rejects empty issue_ids or label_ids", () => {
  const labelId = "5f14e45f-ceea-467e-b7ea-05a3e2b3f4c3"

  assert.throws(() =>
    mutateIssueLabelsSchema.parse({ issue_ids: [], label_ids: [labelId] })
  )
  assert.throws(() =>
    mutateIssueLabelsSchema.parse({ issue_ids: [issueId], label_ids: [] })
  )
})

test("mutateIssueLabelsSchema rejects more than 100 unique issue_ids", () => {
  const labelId = "5f14e45f-ceea-467e-b7ea-05a3e2b3f4c3"
  const issueIds = Array.from(
    { length: 101 },
    (_, index) =>
      `7f14e45f-ceea-467e-b7ea-${index.toString().padStart(12, "0")}`
  )

  assert.throws(() =>
    mutateIssueLabelsSchema.parse({ issue_ids: issueIds, label_ids: [labelId] })
  )
})

test("mutateIssueLabelsSchema rejects more than 20 unique label_ids", () => {
  const labelIds = Array.from(
    { length: 21 },
    (_, index) =>
      `6f14e45f-ceea-467e-b7ea-05a3e2b3${index.toString().padStart(4, "0")}`
  )

  assert.throws(() =>
    mutateIssueLabelsSchema.parse({ issue_ids: [issueId], label_ids: labelIds })
  )
})

test("issueTypeSchema accepts spec alongside the agent-work types", () => {
  assert.deepEqual(issueTypeSchema.options, [
    "issue",
    "feature",
    "bug",
    "feedback",
    "idea",
    "spec",
  ])
})

test("isSpecIssueType singles out spec from every other type", () => {
  assert.deepEqual(
    issueTypeSchema.options.filter((type) => isSpecIssueType(type)),
    ["spec"]
  )
  assert.equal(isSpecIssueType(null), false)
  assert.equal(isSpecIssueType(undefined), false)
})
