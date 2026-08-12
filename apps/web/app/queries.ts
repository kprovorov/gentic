import "server-only"

import {
  groupMessageAttachments,
  selectIssueAttachments,
} from "@gentic/services/attachments"
import * as githubIntegrationsService from "@gentic/services/github-integrations"
import * as issuesService from "@gentic/services/issues"
import * as labelsService from "@gentic/services/labels"
import * as projectsService from "@gentic/services/projects"
import * as userSettingsService from "@gentic/services/user-settings"
import * as workersService from "@gentic/services/workers"
import { ServiceError } from "@gentic/services/errors"
import {
  chatMessageSchema,
  issueEventSchema,
  issueLabelsChangedPayloadSchema,
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
  type AssignedIssueLabel,
  type IssueDetail,
  type IssueEdit,
  type ProjectOption,
} from "./query-contracts"
import type { Attachment } from "./issues/[code]/attachments"
import { createAttachmentSigner } from "./issues/attachment-signing"
import type { ChatMessage } from "./issues/[code]/issue-chat-state"
import {
  listSettingsWorkersData,
  type SettingsWorker,
  type SettingsWorkersData,
} from "./settings/workers-read-model"
import {
  fetchInstallationRepositories,
  type GithubPullRequestState,
} from "@/lib/github-app"

type AttachmentRow = {
  id: string
  issue_id: string
  kind: string
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

export type IssuePullRequest = Omit<issuesService.IssuePullRequest, "state"> & {
  state?: GithubPullRequestState
}

export type IssueEvent = z.infer<typeof issueEventSchema>

export type HomeData = {
  issues: HomeIssue[]
  labels: AssignedIssueLabel[]
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

export type SettingsLabelsData = {
  labels: labelsService.LabelCatalogItem[]
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
  labels: AssignedIssueLabel[]
  archivedLabelIds: string[]
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

// Persisted state (`issue_pull_requests.state`) is a plain `text` column, so
// narrow it back to `GithubPullRequestState` rather than trusting it blindly.
// The GitHub webhook route keeps this column live on every `pull_request`
// event, so rendering just reads it — no per-render GitHub API call.
function attachPullRequestStates<
  T extends { url: string; state?: string | null }
>(
  pullRequests: T[]
): (Omit<T, "state"> & { state?: GithubPullRequestState })[] {
  return pullRequests.map((pullRequest) => ({
    ...pullRequest,
    state:
      pullRequest.state === "draft" ||
      pullRequest.state === "open" ||
      pullRequest.state === "merged" ||
      pullRequest.state === "closed" ||
      pullRequest.state === "queued"
        ? pullRequest.state
        : undefined,
  }))
}

export async function getHomeData(
  context?: AuthenticatedContext
): Promise<HomeData> {
  const { supabase, userId } = await resolveContext(context)
  const [{ data: issues, error }, labels] = await Promise.all([
    supabase
      .from("issues")
      .select(
        "id,title,status,type,priority,agent_provider,number,created_at,issue_pull_requests(id,url,created_at,state),issue_labels(labels!inner(id,name,color,state)),projects(id,name,repo,key)"
      )
      .order("created_at", { ascending: false }),
    labelsService.listLabels(supabase, userId),
  ])

  if (error) {
    throw new Error(error.message)
  }

  const parsedIssues = z.array(homeIssueSchema).parse(issues).map(toHomeIssue)
  const issueIds = parsedIssues.map((issue) => issue.id)
  const [blockedIssueIds, blockingIssueIds] = await Promise.all([
    issuesService.listBlockedIssueIds(supabase, issueIds),
    issuesService.listBlockingIssueIds(supabase, issueIds),
  ])

  const issuesWithPullRequestStates = parsedIssues.map((issue) => ({
    ...issue,
    pullRequests: attachPullRequestStates(issue.pullRequests),
  }))

  return {
    issues: issuesWithPullRequestStates,
    labels: labels.map(({ id, name, color }) => ({ id, name, color })),
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

export async function getSettingsLabelsData(
  context?: AuthenticatedContext,
  filters?: { search?: string }
): Promise<SettingsLabelsData> {
  const { supabase, userId } = await resolveContext(context)
  return {
    labels: await labelsService.listLabels(supabase, userId, filters),
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
      "id,number,title,body,agent_provider,issue_model,type,priority,create_pr_automatically,issue_pull_requests(id),projects(id,name,repo,key)"
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
        "id,issue_id,kind,message_id,file_name,content_type,size_bytes,storage_path,upload_completed_at,deleted_at"
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
  const archivedLabelIds = Array.from(
    await labelsService.listArchivedLabelIds(
      supabase,
      userId,
      collectEventLabelIds(events)
    )
  )

  // The two ownerships are surfaced separately: durable Issue Attachments
  // stand on their own, Message Attachments hang off the turn they were sent
  // with.
  const attachmentRowsByMessageId = groupMessageAttachments(
    (attachmentRows ?? []) satisfies AttachmentRow[]
  )
  // Every row below came back through the Clerk-scoped client above, so RLS
  // has already proven the user owns them — see `createAttachmentSigner`.
  const signAttachment = createAttachmentSigner()
  const attachments: Attachment[] = await Promise.all(
    selectIssueAttachments(
      (attachmentRows ?? []) satisfies AttachmentRow[]
    ).map(signAttachment)
  )
  const messagesWithAttachments = await Promise.all(
    z
      .array(chatMessageSchema)
      .parse(messages ?? [])
      .map(async (message) => ({
        ...message,
        attachments: await Promise.all(
          (attachmentRowsByMessageId.get(message.id) ?? []).map(signAttachment)
        ),
      }))
  )

  return {
    issue: parsedIssue,
    messages: messagesWithAttachments,
    attachments,
    pullRequests: attachPullRequestStates(pullRequests),
    automaticPrPublishingInProgress: (automaticPrRequestRows ?? []).length > 0,
    relations,
    relationCandidates,
    events,
    labels: parsedIssue.labels,
    archivedLabelIds,
  }
}

// Historical `labels_changed` snapshots keep a label's name and color even
// after it is archived, but the timeline still needs to mark those references
// as no longer part of the active catalog — so collect every label id the
// timeline could render and let the caller resolve which are archived.
function collectEventLabelIds(events: IssueEvent[]): string[] {
  const ids = new Set<string>()
  for (const event of events) {
    if (event.type !== "labels_changed") {
      continue
    }
    // `issueEventSchema` already validated this branch's payload, but its
    // generic fallback member keeps `type` a plain string, so narrowing
    // alone doesn't reach the label snapshots.
    const { added, removed } = issueLabelsChangedPayloadSchema.parse(
      event.payload
    )
    for (const label of [...added, ...removed]) {
      ids.add(label.id)
    }
  }
  return Array.from(ids)
}
