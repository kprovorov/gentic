import "server-only"

import * as githubIntegrationsService from "@gentic/services/github-integrations"
import * as issuesService from "@gentic/services/issues"
import * as projectsService from "@gentic/services/projects"
import type { Tables } from "@gentic/supabase/types"
import {
  agentProviderSchema,
  issueStatusSchema,
  issueTypeSchema,
  type IssueStatus,
  type IssueType,
} from "@gentic/validators/issues"
import { chatMessageSchema } from "@gentic/validators/realtime"
import { z } from "zod"

import { getAuthenticatedContext } from "./_lib/auth-context"
import type { Attachment } from "./issues/[id]/attachments"
import type { ChatMessage } from "./issues/[id]/issue-chat-state"

const ATTACHMENTS_BUCKET = "attachments"
const ATTACHMENT_SIGNED_URL_TTL_SECONDS = 3600
const ATTACHMENT_THUMBNAIL_SIZE = 96

type AttachmentRow = Pick<
  Tables<"attachments">,
  "id" | "file_name" | "content_type" | "size_bytes" | "storage_path"
>

const projectOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  repo: z.string(),
})

const homeIssueSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  status: issueStatusSchema,
  type: issueTypeSchema,
  created_at: z.string(),
  projects: projectOptionSchema.nullable(),
})

const issueEditSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  prompt: z.string().nullable(),
  agent_provider: agentProviderSchema,
  type: issueTypeSchema,
})

const issueDetailSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  prompt: z.string().nullable(),
  agent_provider: agentProviderSchema,
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
  title: string | null
  status: IssueStatus
  type: IssueType
  created_at: string
  projects: {
    id: string
    name: string
    repo: string
  } | null
}

export type ProjectOption = {
  id: string
  name: string
  repo: string
}

export type SettingsProject = ProjectOption & {
  setup_script: string | null
  auto_respond_to_reviews: boolean
}

export type IssueDetail = {
  id: string
  title: string | null
  prompt: string | null
  agent_provider: "claude_code" | "codex"
  type: IssueType
  status: IssueStatus
  usage_limit_reset_at: string | null
  run_started_at: string | null
  pr_url: string | null
  created_at: string
  updated_at: string
  projects: ProjectOption | null
}

export type IssuePullRequest = issuesService.IssuePullRequest

export type IssueEdit = Pick<
  IssueDetail,
  "id" | "title" | "prompt" | "agent_provider" | "type"
>

export type HomeData = {
  issues: HomeIssue[]
  blockedIssueIds: string[]
}

export type IssuesData = HomeData

export type SettingsData = {
  projects: SettingsProject[]
  githubIntegration: githubIntegrationsService.GithubIntegration | null
  githubAppConfigured: boolean
}

export type IssueDetailData = {
  issue: IssueDetail
  messages: ChatMessage[]
  attachments: Attachment[]
  pullRequests: IssuePullRequest[]
  relations: issuesService.IssueRelation[]
  relationCandidates: issuesService.IssueRelationIssue[]
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

export async function getHomeData(
  context?: AuthenticatedContext
): Promise<HomeData> {
  const { supabase } = await resolveContext(context)
  const { data: issues, error } = await supabase
    .from("issues")
    .select("id,title,status,type,created_at,projects(id,name,repo)")
    .order("created_at", { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  const parsedIssues = z.array(homeIssueSchema).parse(issues)
  const blockedIssueIds = await issuesService.listBlockedIssueIds(
    supabase,
    parsedIssues.map((issue) => issue.id)
  )

  return {
    issues: parsedIssues,
    blockedIssueIds: Array.from(blockedIssueIds),
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
  const [projects, githubIntegration] = await Promise.all([
    projectsService.listProjects(supabase, userId),
    githubIntegrationsService.getGithubIntegration(supabase, userId),
  ])

  return {
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      repo: project.repo,
      setup_script: project.setup_script,
      auto_respond_to_reviews: project.auto_respond_to_reviews,
    })),
    githubIntegration,
    githubAppConfigured: Boolean(process.env.GITHUB_APP_SLUG),
  }
}

export async function getNewIssueData(
  context?: AuthenticatedContext
): Promise<{ projects: ProjectOption[] }> {
  const { supabase, userId } = await resolveContext(context)
  const projects = await projectsService.listProjects(supabase, userId)

  return {
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      repo: project.repo,
    })),
  }
}

export async function getIssueEditData(
  id: string,
  context?: AuthenticatedContext
): Promise<IssueEdit> {
  const { supabase } = await resolveContext(context)
  const { data: issue, error } = await supabase
    .from("issues")
    .select("id,title,prompt,agent_provider,type")
    .eq("id", id)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  if (!issue) {
    throw new QueryNotFoundError("Issue not found")
  }

  return issueEditSchema.parse(issue)
}

export async function getIssueDetailData(
  id: string,
  context?: AuthenticatedContext
): Promise<IssueDetailData> {
  const { supabase, userId } = await resolveContext(context)
  const { data: issue, error } = await supabase
    .from("issues")
    .select(
      "id,title,prompt,agent_provider,type,status,usage_limit_reset_at,run_started_at,pr_url,created_at,updated_at,projects(id,name,repo)"
    )
    .eq("id", id)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  if (!issue) {
    throw new QueryNotFoundError("Issue not found")
  }

  const parsedIssue = issueDetailSchema.parse(issue)

  const [
    { data: messages, error: messagesError },
    { data: attachmentRows, error: attachmentsError },
    pullRequests,
    relations,
    relationCandidates,
  ] = await Promise.all([
    supabase
      .from("messages")
      .select("id,role,kind,content,status,created_at")
      .eq("issue_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("attachments")
      .select("id,file_name,content_type,size_bytes,storage_path")
      .eq("issue_id", id)
      .order("created_at", { ascending: true }),
    issuesService.listIssuePullRequests(supabase, userId, id),
    issuesService.listIssueRelations(supabase, userId, id),
    issuesService.listIssueRelationCandidates(supabase, userId, id),
  ])

  if (messagesError) {
    throw new Error(messagesError.message)
  }
  if (attachmentsError) {
    throw new Error(attachmentsError.message)
  }

  const attachments: Attachment[] = await Promise.all(
    ((attachmentRows ?? []) satisfies AttachmentRow[]).map(async (attachment) => {
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
    })
  )

  return {
    issue: parsedIssue,
    messages: z.array(chatMessageSchema).parse(messages ?? []),
    attachments,
    pullRequests,
    relations,
    relationCandidates,
  }
}
