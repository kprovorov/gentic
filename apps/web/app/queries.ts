import "server-only"

import * as githubIntegrationsService from "@gentic/services/github-integrations"
import * as issuesService from "@gentic/services/issues"
import * as projectsService from "@gentic/services/projects"
import * as userSettingsService from "@gentic/services/user-settings"
import * as workersService from "@gentic/services/workers"
import { ServiceError } from "@gentic/services/errors"
import {
  chatMessageSchema,
  issueEventSchema,
} from "@gentic/validators/realtime"
import { z } from "zod"

import { getAuthenticatedContext } from "./_lib/auth-context"
import {
  homeIssueSchema,
  issueDetailSchema,
  issueEditSchema,
  toHomeIssue,
  toIssueDetail,
  toIssueEdit,
  type HomeIssue,
  type IssueDetail,
  type IssueEdit,
  type ProjectOption,
} from "./query-contracts"
import type { Attachment } from "./issues/[code]/attachments"
import type { ChatMessage } from "./issues/[code]/issue-chat-state"
import {
  listSettingsWorkersData,
  type SettingsWorker,
  type SettingsWorkersData,
} from "./settings/workers-read-model"
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

export type { HomeIssue, IssueDetail, IssueEdit, ProjectOption }

export type SettingsProject = ProjectOption & {
  setup_script: string | null
  auto_respond_to_reviews: boolean
}

export type GithubRepositoryOption = {
  full_name: string
  private: boolean
}

export type IssuePullRequest = issuesService.IssuePullRequest & {
  state?: GithubPullRequestState
}

export type IssueEvent = z.infer<typeof issueEventSchema>

export type HomeData = {
  issues: HomeIssue[]
  blockedIssueIds: string[]
  blockingIssueIds: string[]
}

export type IssuesData = HomeData

export type SettingsData = {
  projects: SettingsProject[]
  workers: workersService.WorkerDomain[]
  githubIntegration: githubIntegrationsService.GithubIntegration | null
  defaultAgentProvider: "claude_code" | "codex"
  githubAppConfigured: boolean
  githubRepositories: GithubRepositoryOption[]
  githubRepositoriesError: string | null
}

export type { SettingsWorker, SettingsWorkersData }

export type NewIssueData = {
  projects: ProjectOption[]
  defaultAgentProvider: "claude_code" | "codex"
}

export type IssueDetailData = {
  issue: IssueDetail
  messages: ChatMessage[]
  attachments: Attachment[]
  pullRequests: IssuePullRequest[]
  automaticPrPublishingInProgress: boolean
  relations: issuesService.IssueRelation[]
  relationCandidates: issuesService.IssueRelationIssue[]
  events: IssueEvent[]
}

type AuthenticatedContext = Awaited<ReturnType<typeof getAuthenticatedContext>>

export class QueryNotFoundError extends Error {
  constructor(message = "Not found") {
    super(message)
    this.name = "QueryNotFoundError"
  }
}

async function resolveContext(context?: AuthenticatedContext) {
  return context ?? getAuthenticatedContext()
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

async function attachPullRequestStates<T extends { url: string }>(
  pullRequests: T[],
  installationId: string | null | undefined
): Promise<(T & { state?: GithubPullRequestState })[]> {
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

export async function getHomeData(
  context?: AuthenticatedContext
): Promise<HomeData> {
  const { supabase, userId } = await resolveContext(context)
  const { data: issues, error } = await supabase
    .from("issues")
    .select(
      "id,title,status,type,priority,number,created_at,issue_pull_requests(id,url,created_at),projects(id,name,repo,key)"
    )
    .order("created_at", { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  const parsedIssues = z.array(homeIssueSchema).parse(issues).map(toHomeIssue)
  const issueIds = parsedIssues.map((issue) => issue.id)
  const [blockedIssueIds, blockingIssueIds, githubIntegration] =
    await Promise.all([
      issuesService.listBlockedIssueIds(supabase, issueIds),
      issuesService.listBlockingIssueIds(supabase, issueIds),
      githubIntegrationsService.getGithubIntegration(supabase, userId),
    ])

  const issuesWithPullRequestStates = await Promise.all(
    parsedIssues.map(async (issue) => ({
      ...issue,
      pullRequests: await attachPullRequestStates(
        issue.pullRequests,
        githubIntegration?.installation_id
      ),
    }))
  )

  return {
    issues: issuesWithPullRequestStates,
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
  const [projects, githubIntegration, userSettings, workers] =
    await Promise.all([
      projectsService.listProjects(supabase, userId),
      githubIntegrationsService.getGithubIntegration(supabase, userId),
      userSettingsService.getUserSettings(supabase, userId),
      workersService.listWorkers(supabase, userId),
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
    workers,
    githubIntegration,
    defaultAgentProvider: userSettings.default_agent_provider,
    githubAppConfigured: Boolean(process.env.GITHUB_APP_SLUG),
    githubRepositories,
    githubRepositoriesError,
  }
}

export async function getSettingsWorkersData(
  context?: AuthenticatedContext
): Promise<SettingsWorkersData> {
  const { supabase, userId } = await resolveContext(context)
  return listSettingsWorkersData(supabase, userId)
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
      "id,number,title,prompt,agent_provider,issue_model,type,priority,create_pr_automatically,pr_url,issue_pull_requests(id),projects(id,name,repo,key)"
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

  const pullRequests = await issuesService.listIssuePullRequests(
    supabase,
    userId,
    issue.id
  )

  return toIssueEdit(
    issueEditSchema.parse({
      ...issue,
      issue_pull_requests: pullRequests.map((pullRequest) => ({
        id: pullRequest.id,
      })),
    })
  )
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
    { data: automaticPrRequestRows, error: automaticPrRequestsError },
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
    supabase
      .from("issue_automatic_pr_requests")
      .select("id,status")
      .eq("issue_id", id)
      .in("status", ["pending", "claimed"]),
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
  if (automaticPrRequestsError) {
    throw new Error(automaticPrRequestsError.message)
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
    automaticPrPublishingInProgress: (automaticPrRequestRows ?? []).length > 0,
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
