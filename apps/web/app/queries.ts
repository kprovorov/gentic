import "server-only"

import * as githubIntegrationsService from "@gentic/services/github-integrations"
import * as issuesService from "@gentic/services/issues"
import * as projectsService from "@gentic/services/projects"
import * as userSettingsService from "@gentic/services/user-settings"
import { ServiceError } from "@gentic/services/errors"
import {
  agentProviderSchema,
  issueStatusSchema,
  issueTypeSchema,
  type IssueStatus,
  type IssueType,
} from "@gentic/validators/issues"
import {
  chatMessageSchema,
  issueEventSchema,
} from "@gentic/validators/realtime"
import { z } from "zod"

import { getAuthenticatedContext } from "./_lib/auth-context"
import type { Attachment } from "./issues/[code]/attachments"
import type { ChatMessage } from "./issues/[code]/issue-chat-state"
import {
  fetchInstallationRepositories,
  fetchPullRequestState,
  type GithubPullRequestState,
} from "@/lib/github-app"

const ATTACHMENTS_BUCKET = "attachments"
const ATTACHMENT_SIGNED_URL_TTL_SECONDS = 3600
const ATTACHMENT_THUMBNAIL_SIZE = 96

type AttachmentRow = {
  id: string
  issue_id: string
  message_id: string | null
  file_name: string
  content_type: string | null
  size_bytes: number | null
  storage_path: string
  upload_completed_at: string | null
  deleted_at: string | null
}

const projectOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  repo: z.string(),
  key: z.string(),
})

const homeIssueSchema = z.object({
  id: z.string(),
  number: z.number().int().positive(),
  title: z.string().nullable(),
  status: issueStatusSchema,
  type: issueTypeSchema,
  created_at: z.string(),
  projects: projectOptionSchema.nullable(),
})

const issueEditSchema = z.object({
  id: z.string(),
  number: z.number().int().positive(),
  title: z.string().nullable(),
  prompt: z.string().nullable(),
  agent_provider: agentProviderSchema,
  issue_model: z.string().nullable(),
  type: issueTypeSchema,
  projects: projectOptionSchema.nullable(),
})

const issueDetailSchema = z.object({
  id: z.string(),
  number: z.number().int().positive(),
  title: z.string().nullable(),
  prompt: z.string().nullable(),
  agent_provider: agentProviderSchema,
  issue_model: z.string().nullable(),
  type: issueTypeSchema,
  status: issueStatusSchema,
  usage_limit_reset_at: z.string().nullable(),
  run_started_at: z.string().nullable(),
  pr_url: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  projects: projectOptionSchema.nullable(),
})

export type HomeIssue = {
  id: string
  code: string | null
  number: number
  title: string | null
  status: IssueStatus
  type: IssueType
  created_at: string
  projects: {
    id: string
    name: string
    repo: string
    key: string
  } | null
}

export type ProjectOption = {
  id: string
  name: string
  repo: string
  key: string
}

export type SettingsProject = ProjectOption & {
  setup_script: string | null
  auto_respond_to_reviews: boolean
}

export type GithubRepositoryOption = {
  full_name: string
  private: boolean
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
  status: IssueStatus
  usage_limit_reset_at: string | null
  run_started_at: string | null
  pr_url: string | null
  created_at: string
  updated_at: string
  projects: ProjectOption | null
}

export type IssuePullRequest = issuesService.IssuePullRequest & {
  state?: GithubPullRequestState
}

export type IssueEvent = z.infer<typeof issueEventSchema>

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
  | "projects"
>

export type HomeData = {
  issues: HomeIssue[]
  blockedIssueIds: string[]
  blockingIssueIds: string[]
}

export type IssuesData = HomeData

export type SettingsData = {
  projects: SettingsProject[]
  githubIntegration: githubIntegrationsService.GithubIntegration | null
  defaultAgentProvider: "claude_code" | "codex"
  githubAppConfigured: boolean
  githubRepositories: GithubRepositoryOption[]
  githubRepositoriesError: string | null
}

export type NewIssueData = {
  projects: ProjectOption[]
  defaultAgentProvider: "claude_code" | "codex"
}

export type IssueDetailData = {
  issue: IssueDetail
  messages: ChatMessage[]
  attachments: Attachment[]
  pullRequests: IssuePullRequest[]
  relations: issuesService.IssueRelation[]
  relationCandidates: issuesService.IssueRelationIssue[]
  events: IssueEvent[]
}

type AuthenticatedContext = Awaited<ReturnType<typeof getAuthenticatedContext>>
type IssueDetailRow = z.infer<typeof issueDetailSchema>
type IssueEditRow = z.infer<typeof issueEditSchema>

export class QueryNotFoundError extends Error {
  constructor(message = "Not found") {
    super(message)
    this.name = "QueryNotFoundError"
  }
}

async function resolveContext(context?: AuthenticatedContext) {
  return context ?? getAuthenticatedContext()
}

function getDisplayIssueCode(issue: {
  number: number
  projects: { key: string } | null
}) {
  return issue.projects
    ? issuesService.getIssueCode(issue.projects.key, issue.number)
    : null
}

function toProjectOption(project: ProjectOption | null) {
  return project
    ? {
        id: project.id,
        name: project.name,
        repo: project.repo,
        key: project.key,
      }
    : null
}

function parseGithubPullRequestUrl(url: string) {
  try {
    const [, owner, repo, resource, number] = new URL(url).pathname.split("/")
    if (owner && repo && resource === "pull" && number) {
      const pullNumber = Number.parseInt(number, 10)
      if (Number.isInteger(pullNumber) && pullNumber > 0) {
        return { owner, repo, pullNumber }
      }
    }
  } catch {
    return null
  }

  return null
}

async function attachPullRequestStates(
  pullRequests: issuesService.IssuePullRequest[],
  installationId: string | null | undefined
): Promise<IssuePullRequest[]> {
  if (!installationId || pullRequests.length === 0) {
    return pullRequests
  }

  return Promise.all(
    pullRequests.map(async (pullRequest) => {
      const parsed = parseGithubPullRequestUrl(pullRequest.url)
      if (!parsed) {
        return pullRequest
      }

      try {
        const state = await fetchPullRequestState(
          installationId,
          parsed.owner,
          parsed.repo,
          parsed.pullNumber
        )
        return { ...pullRequest, state }
      } catch (error) {
        console.error(
          "[issue-detail] failed to fetch pull request state:",
          error
        )
        return pullRequest
      }
    })
  )
}

function toIssueDetail(issue: IssueDetailRow): IssueDetail {
  return {
    id: issue.id,
    code: getDisplayIssueCode(issue),
    number: issue.number,
    title: issue.title,
    prompt: issue.prompt,
    agent_provider: issue.agent_provider,
    issue_model: issue.issue_model,
    type: issue.type,
    status: issue.status,
    usage_limit_reset_at: issue.usage_limit_reset_at,
    run_started_at: issue.run_started_at,
    pr_url: issue.pr_url,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    projects: toProjectOption(issue.projects),
  }
}

function toIssueEdit(issue: IssueEditRow): IssueEdit {
  return {
    id: issue.id,
    code: getDisplayIssueCode(issue),
    number: issue.number,
    title: issue.title,
    prompt: issue.prompt,
    agent_provider: issue.agent_provider,
    issue_model: issue.issue_model,
    type: issue.type,
    projects: toProjectOption(issue.projects),
  }
}

export async function getHomeData(
  context?: AuthenticatedContext
): Promise<HomeData> {
  const { supabase } = await resolveContext(context)
  const { data: issues, error } = await supabase
    .from("issues")
    .select("id,title,status,type,number,created_at,projects(id,name,repo,key)")
    .order("created_at", { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  const parsedIssues = z
    .array(homeIssueSchema)
    .parse(issues)
    .map((issue) => ({
      id: issue.id,
      code: getDisplayIssueCode(issue),
      number: issue.number,
      title: issue.title,
      status: issue.status,
      type: issue.type,
      created_at: issue.created_at,
      projects: toProjectOption(issue.projects),
    }))
  const issueIds = parsedIssues.map((issue) => issue.id)
  const [blockedIssueIds, blockingIssueIds] = await Promise.all([
    issuesService.listBlockedIssueIds(supabase, issueIds),
    issuesService.listBlockingIssueIds(supabase, issueIds),
  ])

  return {
    issues: parsedIssues,
    blockedIssueIds: Array.from(blockedIssueIds),
    blockingIssueIds: Array.from(blockingIssueIds),
  }
}

export async function getIssuesData(
  context?: AuthenticatedContext
): Promise<IssuesData> {
  return getHomeData(context)
}

export async function getSettingsData(
  context?: AuthenticatedContext
): Promise<SettingsData> {
  const { supabase, userId } = await resolveContext(context)
  const [projects, githubIntegration, userSettings] = await Promise.all([
    projectsService.listProjects(supabase, userId),
    githubIntegrationsService.getGithubIntegration(supabase, userId),
    userSettingsService.getUserSettings(supabase, userId),
  ])

  let githubRepositories: GithubRepositoryOption[] = []
  let githubRepositoriesError: string | null = null

  if (
    githubIntegration?.status === "connected" &&
    githubIntegration.installation_id
  ) {
    try {
      githubRepositories = await fetchInstallationRepositories(
        githubIntegration.installation_id
      )
    } catch (error) {
      console.error("[settings] failed to fetch GitHub repositories:", error)
      githubRepositoriesError = "Unable to load GitHub repositories."
    }
  }

  return {
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      repo: project.repo,
      key: project.key,
      setup_script: project.setup_script,
      auto_respond_to_reviews: project.auto_respond_to_reviews,
    })),
    githubIntegration,
    defaultAgentProvider: userSettings.default_agent_provider,
    githubAppConfigured: Boolean(process.env.GITHUB_APP_SLUG),
    githubRepositories,
    githubRepositoriesError,
  }
}

export async function getNewIssueData(
  context?: AuthenticatedContext
): Promise<NewIssueData> {
  const { supabase, userId } = await resolveContext(context)
  const [projects, userSettings] = await Promise.all([
    projectsService.listProjects(supabase, userId),
    userSettingsService.getUserSettings(supabase, userId),
  ])

  return {
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      repo: project.repo,
      key: project.key,
    })),
    defaultAgentProvider: userSettings.default_agent_provider,
  }
}

export async function getIssueEditData(
  id: string,
  context?: AuthenticatedContext
): Promise<IssueEdit> {
  const { supabase } = await resolveContext(context)
  const { data: issue, error } = await supabase
    .from("issues")
    .select(
      "id,number,title,prompt,agent_provider,issue_model,type,projects(id,name,repo,key)"
    )
    .eq("id", id)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  if (!issue) {
    throw new QueryNotFoundError("Issue not found")
  }

  return toIssueEdit(issueEditSchema.parse(issue))
}

export async function getIssueEditDataByCode(
  projectKey: string,
  issueNumber: number,
  context?: AuthenticatedContext
): Promise<IssueEdit> {
  const { supabase, userId } = await resolveContext(context)
  const issue = await getScopedIssueByCode(
    supabase,
    userId,
    projectKey,
    issueNumber
  )

  return toIssueEdit(issue)
}

export async function getIssueDetailData(
  projectKey: string,
  issueNumber: number,
  context?: AuthenticatedContext
): Promise<IssueDetailData> {
  const { supabase, userId } = await resolveContext(context)
  const issue = await getScopedIssueByCode(
    supabase,
    userId,
    projectKey,
    issueNumber
  )

  return getIssueDetailDataForIssue(issue, { supabase, userId })
}

export async function getIssueDetailDataById(
  id: string,
  context?: AuthenticatedContext
): Promise<IssueDetailData> {
  const { supabase, userId } = await resolveContext(context)
  const issue = await getScopedIssueById(supabase, userId, id)

  return getIssueDetailDataForIssue(issue, { supabase, userId })
}

async function getScopedIssueByCode(
  supabase: AuthenticatedContext["supabase"],
  userId: string,
  projectKey: string,
  issueNumber: number
) {
  try {
    return toIssueDetail(
      issueDetailSchema.parse(
        await issuesService.getIssueByCode(
          supabase,
          userId,
          projectKey,
          issueNumber
        )
      )
    )
  } catch (error) {
    if (error instanceof ServiceError && error.code === "not_found") {
      throw new QueryNotFoundError("Issue not found")
    }
    throw error
  }
}

async function getScopedIssueById(
  supabase: AuthenticatedContext["supabase"],
  userId: string,
  id: string
) {
  try {
    return toIssueDetail(
      issueDetailSchema.parse(
        await issuesService.getIssue(supabase, userId, id)
      )
    )
  } catch (error) {
    if (error instanceof ServiceError && error.code === "not_found") {
      throw new QueryNotFoundError("Issue not found")
    }
    throw error
  }
}

async function getIssueDetailDataForIssue(
  parsedIssue: IssueDetail,
  context?: AuthenticatedContext
): Promise<IssueDetailData> {
  const { supabase, userId } = await resolveContext(context)
  const id = parsedIssue.id

  const [
    { data: messages, error: messagesError },
    { data: attachmentRows, error: attachmentsError },
    { data: eventRows, error: eventsError },
    pullRequests,
    relations,
    relationCandidates,
    githubIntegration,
  ] = await Promise.all([
    supabase
      .from("messages")
      .select(
        "id,role,kind,content,status,author_type,generated_action,created_at,event_id,run_id,event_type,event_status,event_ts,event_seq,tool_call_id,payload"
      )
      .eq("issue_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("attachments")
      .select(
        "id,issue_id,message_id,file_name,content_type,size_bytes,storage_path,upload_completed_at,deleted_at"
      )
      .eq("issue_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("issue_events")
      .select("id,issue_id,type,payload,created_at")
      .eq("issue_id", id)
      .order("created_at", { ascending: true }),
    issuesService.listIssuePullRequests(supabase, userId, id),
    issuesService.listIssueRelations(supabase, userId, id),
    issuesService.listIssueRelationCandidates(supabase, userId, id),
    githubIntegrationsService.getGithubIntegration(supabase, userId),
  ])

  if (messagesError) {
    throw new Error(messagesError.message)
  }
  if (attachmentsError) {
    throw new Error(attachmentsError.message)
  }
  if (eventsError) {
    throw new Error(eventsError.message)
  }

  const events = z.array(issueEventSchema).parse(eventRows ?? [])

  const attachmentRowsByMessageId = groupCompletedAttachmentRowsByMessageId(
    (attachmentRows ?? []) satisfies AttachmentRow[]
  )
  const attachments: Attachment[] = await Promise.all(
    ((attachmentRows ?? []) satisfies AttachmentRow[])
      .filter(
        (attachment) =>
          attachment.deleted_at === null &&
          attachment.upload_completed_at !== null
      )
      .map((attachment) => signAttachment(supabase, attachment))
  )
  const messagesWithAttachments = await Promise.all(
    z
      .array(chatMessageSchema)
      .parse(messages ?? [])
      .map(async (message) => ({
        ...message,
        attachments: await Promise.all(
          (attachmentRowsByMessageId.get(message.id) ?? []).map((attachment) =>
            signAttachment(supabase, attachment)
          )
        ),
      }))
  )

  return {
    issue: parsedIssue,
    messages: messagesWithAttachments,
    attachments,
    pullRequests: await attachPullRequestStates(
      pullRequests,
      githubIntegration?.installation_id
    ),
    relations,
    relationCandidates,
    events,
  }
}

function groupCompletedAttachmentRowsByMessageId(attachments: AttachmentRow[]) {
  const grouped = new Map<string, AttachmentRow[]>()
  for (const attachment of attachments) {
    if (!attachment.message_id) {
      continue
    }
    if (
      attachment.upload_completed_at === null &&
      attachment.deleted_at === null
    ) {
      continue
    }
    grouped.set(attachment.message_id, [
      ...(grouped.get(attachment.message_id) ?? []),
      attachment,
    ])
  }
  return grouped
}

async function signAttachment(
  supabase: AuthenticatedContext["supabase"],
  attachment: AttachmentRow
): Promise<Attachment> {
  if (attachment.deleted_at) {
    return {
      id: attachment.id,
      fileName: attachment.file_name,
      sizeBytes: attachment.size_bytes,
      url: null,
      thumbnailUrl: null,
    }
  }

  const isImage = attachment.content_type?.startsWith("image/") ?? false
  const storage = supabase.storage.from(ATTACHMENTS_BUCKET)
  const [{ data: signed }, { data: thumbnail }] = await Promise.all([
    storage.createSignedUrl(
      attachment.storage_path,
      ATTACHMENT_SIGNED_URL_TTL_SECONDS
    ),
    isImage
      ? storage.createSignedUrl(
          attachment.storage_path,
          ATTACHMENT_SIGNED_URL_TTL_SECONDS,
          {
            transform: {
              width: ATTACHMENT_THUMBNAIL_SIZE,
              height: ATTACHMENT_THUMBNAIL_SIZE,
              resize: "cover",
            },
          }
        )
      : Promise.resolve({ data: null }),
  ])

  return {
    id: attachment.id,
    fileName: attachment.file_name,
    sizeBytes: attachment.size_bytes,
    url: signed?.signedUrl ?? null,
    thumbnailUrl: thumbnail?.signedUrl ?? null,
  }
}
