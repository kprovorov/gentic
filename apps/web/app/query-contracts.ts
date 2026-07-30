import * as issuesService from "@gentic/services/issues"
import {
  agentProviderSchema,
  issuePrioritySchema,
  issueStatusSchema,
  issueTypeSchema,
  hasAttachedIssuePullRequest,
  type IssuePriority,
  type IssueStatus,
  type IssueType,
} from "@gentic/validators/issues"
import { z } from "zod"

const projectOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  repo: z.string(),
  key: z.string(),
})

export const homeIssueSchema = z.object({
  id: z.string(),
  number: z.number().int().positive(),
  title: z.string().nullable(),
  status: issueStatusSchema,
  type: issueTypeSchema,
  priority: issuePrioritySchema,
  created_at: z.string(),
  issue_pull_requests: z.array(
    z.object({
      id: z.string(),
      url: z.string(),
      created_at: z.string(),
    })
  ),
  projects: projectOptionSchema.nullable(),
})

export const issueEditSchema = z.object({
  id: z.string(),
  number: z.number().int().positive(),
  title: z.string().nullable(),
  prompt: z.string().nullable(),
  agent_provider: agentProviderSchema,
  issue_model: z.string().nullable(),
  type: issueTypeSchema,
  priority: issuePrioritySchema,
  create_pr_automatically: z.boolean(),
  pr_url: z.string().nullable(),
  issue_pull_requests: z.array(z.object({ id: z.string() })).optional(),
  projects: projectOptionSchema.nullable(),
})

export const issueDetailSchema = z.object({
  id: z.string(),
  number: z.number().int().positive(),
  title: z.string().nullable(),
  prompt: z.string().nullable(),
  agent_provider: agentProviderSchema,
  issue_model: z.string().nullable(),
  type: issueTypeSchema,
  priority: issuePrioritySchema,
  status: issueStatusSchema,
  active_run_id: z.string().nullable(),
  usage_limit_reset_at: z.string().nullable(),
  run_started_at: z.string().nullable(),
  has_unpublished_agent_changes: z.boolean(),
  pr_url: z.string().nullable(),
  create_pr_automatically: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
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
  created_at: string
  pullRequests: {
    id: string
    url: string
  }[]
  projects: ProjectOption | null
}

export type IssueDetail = {
  id: string
  code: string | null
  number: number
  title: string | null
  prompt: string | null
  agent_provider: "claude_code" | "codex"
  issue_model: string | null
  type: IssueType
  priority: IssuePriority
  status: IssueStatus
  active_run_id: string | null
  usage_limit_reset_at: string | null
  run_started_at: string | null
  has_unpublished_agent_changes: boolean
  pr_url: string | null
  create_pr_automatically: boolean
  created_at: string
  updated_at: string
  projects: ProjectOption | null
}

export type IssueEdit = Pick<
  IssueDetail,
  | "id"
  | "code"
  | "number"
  | "title"
  | "prompt"
  | "agent_provider"
  | "issue_model"
  | "type"
  | "priority"
  | "create_pr_automatically"
  | "projects"
> & {
  has_attached_pull_request: boolean
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
    created_at: issue.created_at,
    pullRequests: issue.issue_pull_requests
      .toSorted((a, b) => b.created_at.localeCompare(a.created_at))
      .map(({ id, url }) => ({ id, url })),
    projects: toProjectOption(issue.projects),
  }
}

export function toIssueDetail(issue: IssueDetailRow): IssueDetail {
  return {
    id: issue.id,
    code: getDisplayIssueCode(issue),
    number: issue.number,
    title: issue.title,
    prompt: issue.prompt,
    agent_provider: issue.agent_provider,
    issue_model: issue.issue_model,
    type: issue.type,
    priority: issue.priority,
    status: issue.status,
    active_run_id: issue.active_run_id,
    usage_limit_reset_at: issue.usage_limit_reset_at,
    run_started_at: issue.run_started_at,
    has_unpublished_agent_changes: issue.has_unpublished_agent_changes,
    pr_url: issue.pr_url,
    create_pr_automatically: issue.create_pr_automatically,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    projects: toProjectOption(issue.projects),
  }
}

export function toIssueEdit(issue: IssueEditRow): IssueEdit {
  return {
    id: issue.id,
    code: getDisplayIssueCode(issue),
    number: issue.number,
    title: issue.title,
    prompt: issue.prompt,
    agent_provider: issue.agent_provider,
    issue_model: issue.issue_model,
    type: issue.type,
    priority: issue.priority,
    create_pr_automatically: issue.create_pr_automatically,
    has_attached_pull_request: hasAttachedIssuePullRequest(issue),
    projects: toProjectOption(issue.projects),
  }
}
