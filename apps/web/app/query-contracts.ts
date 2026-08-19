import * as issuesService from "@gentic/services/issues"
import {
  agentProviderSchema,
  issuePrioritySchema,
  issueStatusSchema,
  issueTypeSchema,
  hasAttachedIssuePullRequest,
  type AgentProvider,
  type IssuePriority,
  type IssueStatus,
  type IssueType,
} from "@gentic/validators/issues"
import { z } from "zod"

import type { GithubPullRequestState } from "@/lib/github-app"

const projectOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  repo: z.string(),
  key: z.string(),
})

export const assignedIssueLabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
})

const issueLabelJoinSchema = z.object({
  labels: assignedIssueLabelSchema.extend({ state: z.string() }),
})

export const homeIssueSchema = z.object({
  id: z.string(),
  number: z.number().int().positive(),
  title: z.string().nullable(),
  status: issueStatusSchema,
  type: issueTypeSchema,
  priority: issuePrioritySchema,
  agent_provider: agentProviderSchema,
  created_at: z.string(),
  issue_pull_requests: z.array(
    z.object({
      id: z.string(),
      url: z.string(),
      created_at: z.string(),
      state: z.string().nullable(),
    })
  ),
  issue_labels: z.array(issueLabelJoinSchema),
  projects: projectOptionSchema.nullable(),
})

const projectAutomaticReviewSchema = z.object({
  automatic_review_enabled: z.boolean(),
  automatic_review_provider: agentProviderSchema.nullable(),
  automatic_review_model: z.string().nullable(),
  automatic_review_instructions: z.string().nullable(),
})

export const issueEditSchema = z.object({
  id: z.string(),
  number: z.number().int().positive(),
  title: z.string().nullable(),
  body: z.string().nullable(),
  agent_provider: agentProviderSchema,
  issue_model: z.string().nullable(),
  type: issueTypeSchema,
  priority: issuePrioritySchema,
  create_pr_automatically: z.boolean(),
  // Null inherits the Project's Automatic Review default.
  automatic_review_enabled: z.boolean().nullable(),
  issue_pull_requests: z.array(z.object({ id: z.string() })).optional(),
  projects: projectOptionSchema.merge(projectAutomaticReviewSchema).nullable(),
})

export const issueDetailSchema = z.object({
  id: z.string(),
  number: z.number().int().positive(),
  title: z.string().nullable(),
  body: z.string().nullable(),
  agent_provider: agentProviderSchema,
  issue_model: z.string().nullable(),
  type: issueTypeSchema,
  priority: issuePrioritySchema,
  status: issueStatusSchema,
  active_run_id: z.string().nullable(),
  usage_limit_reset_at: z.string().nullable(),
  run_started_at: z.string().nullable(),
  has_unpublished_agent_changes: z.boolean(),
  create_pr_automatically: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  labels: z.array(assignedIssueLabelSchema),
  projects: projectOptionSchema.nullable(),
})

export type ProjectOption = {
  id: string
  name: string
  repo: string
  key: string
}

export type HomeIssue = {
  id: string
  code: string | null
  number: number
  title: string | null
  status: IssueStatus
  type: IssueType
  priority: IssuePriority
  agent_provider: AgentProvider
  created_at: string
  pullRequests: {
    id: string
    url: string
    state?: GithubPullRequestState
  }[]
  labels: AssignedIssueLabel[]
  projects: ProjectOption | null
}

export type AssignedIssueLabel = z.infer<typeof assignedIssueLabelSchema>

export type IssueDetail = {
  id: string
  code: string | null
  number: number
  title: string | null
  body: string | null
  agent_provider: "claude_code" | "codex"
  issue_model: string | null
  type: IssueType
  priority: IssuePriority
  status: IssueStatus
  active_run_id: string | null
  usage_limit_reset_at: string | null
  run_started_at: string | null
  has_unpublished_agent_changes: boolean
  create_pr_automatically: boolean
  created_at: string
  updated_at: string
  labels: AssignedIssueLabel[]
  projects: ProjectOption | null
}

export type ProjectAutomaticReviewDefaults = {
  enabled: boolean
  provider: AgentProvider | null
  model: string | null
  instructions: string | null
}

export type IssueReviewPolicySnapshot = {
  enabled: boolean
  reviewer_provider: AgentProvider
  reviewer_model: string | null
  reviewer_instructions: string | null
  created_at: string
}

export type IssueEdit = Pick<
  IssueDetail,
  | "id"
  | "code"
  | "number"
  | "title"
  | "body"
  | "agent_provider"
  | "issue_model"
  | "type"
  | "priority"
  | "create_pr_automatically"
  | "projects"
> & {
  has_attached_pull_request: boolean
  // Null inherits the Project's Automatic Review default.
  automatic_review_enabled: boolean | null
  project_automatic_review: ProjectAutomaticReviewDefaults | null
  // The frozen policy, present only once a pull request has been associated.
  automatic_review_policy: IssueReviewPolicySnapshot | null
}

const issueReviewPolicyRowSchema = z.object({
  enabled: z.boolean(),
  reviewer_provider: agentProviderSchema,
  reviewer_model: z.string().nullable(),
  reviewer_instructions: z.string().nullable(),
  created_at: z.string(),
})

export function toIssueReviewPolicySnapshot(
  policy: {
    enabled: boolean
    reviewer_provider: string
    reviewer_model: string | null
    reviewer_instructions: string | null
    created_at: string
  } | null
): IssueReviewPolicySnapshot | null {
  return policy ? issueReviewPolicyRowSchema.parse(policy) : null
}

export type IssueDetailRow = z.infer<typeof issueDetailSchema>
export type IssueEditRow = z.infer<typeof issueEditSchema>
export type HomeIssueRow = z.infer<typeof homeIssueSchema>

export function getDisplayIssueCode(issue: {
  number: number
  projects: { key: string } | null
}) {
  return issue.projects
    ? issuesService.getIssueCode(issue.projects.key, issue.number)
    : null
}

// `issue_pull_requests.state` is a plain `text` column (not an enum), so
// narrow it back to `GithubPullRequestState` rather than trusting the value
// unconditionally.
function normalizePersistedPullRequestState(
  state: string | null
): GithubPullRequestState | undefined {
  return state === "draft" ||
    state === "open" ||
    state === "merged" ||
    state === "closed" ||
    state === "queued"
    ? state
    : undefined
}

export function toProjectOption(project: ProjectOption | null) {
  return project
    ? {
        id: project.id,
        name: project.name,
        repo: project.repo,
        key: project.key,
      }
    : null
}

export function toHomeIssue(issue: HomeIssueRow): HomeIssue {
  return {
    id: issue.id,
    code: getDisplayIssueCode(issue),
    number: issue.number,
    title: issue.title,
    status: issue.status,
    type: issue.type,
    priority: issue.priority,
    agent_provider: issue.agent_provider,
    created_at: issue.created_at,
    pullRequests: issue.issue_pull_requests
      .toSorted((a, b) => b.created_at.localeCompare(a.created_at))
      .map(({ id, url, state }) => ({
        id,
        url,
        state: normalizePersistedPullRequestState(state),
      })),
    labels: issue.issue_labels
      .map((assignment) => assignment.labels)
      .filter((label) => label.state === "active")
      .map(({ id, name, color }) => ({ id, name, color }))
      .toSorted((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      ),
    projects: toProjectOption(issue.projects),
  }
}

export function toIssueDetail(issue: IssueDetailRow): IssueDetail {
  return {
    id: issue.id,
    code: getDisplayIssueCode(issue),
    number: issue.number,
    title: issue.title,
    body: issue.body,
    agent_provider: issue.agent_provider,
    issue_model: issue.issue_model,
    type: issue.type,
    priority: issue.priority,
    status: issue.status,
    active_run_id: issue.active_run_id,
    usage_limit_reset_at: issue.usage_limit_reset_at,
    run_started_at: issue.run_started_at,
    has_unpublished_agent_changes: issue.has_unpublished_agent_changes,
    create_pr_automatically: issue.create_pr_automatically,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    labels: issue.labels.toSorted((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    ),
    projects: toProjectOption(issue.projects),
  }
}

export function toIssueEdit(
  issue: IssueEditRow,
  automaticReviewPolicy: IssueReviewPolicySnapshot | null = null
): IssueEdit {
  return {
    id: issue.id,
    code: getDisplayIssueCode(issue),
    number: issue.number,
    title: issue.title,
    body: issue.body,
    agent_provider: issue.agent_provider,
    issue_model: issue.issue_model,
    type: issue.type,
    priority: issue.priority,
    create_pr_automatically: issue.create_pr_automatically,
    automatic_review_enabled: issue.automatic_review_enabled,
    has_attached_pull_request: hasAttachedIssuePullRequest(issue),
    projects: toProjectOption(issue.projects),
    project_automatic_review: issue.projects
      ? {
          enabled: issue.projects.automatic_review_enabled,
          provider: issue.projects.automatic_review_provider,
          model: issue.projects.automatic_review_model,
          instructions: issue.projects.automatic_review_instructions,
        }
      : null,
    automatic_review_policy: automaticReviewPolicy,
  }
}
