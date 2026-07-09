"use server"

import { notFound } from "next/navigation"

import * as githubIntegrationsService from "@gentic/services/github-integrations"
import * as issuesService from "@gentic/services/issues"
import * as projectsService from "@gentic/services/projects"

import { getAuthenticatedContext } from "./_lib/auth-context"
import type { Attachment } from "./issues/[id]/attachments"
import type { ChatMessage, RunStatus } from "./issues/[id]/issue-chat"

const ATTACHMENTS_BUCKET = "attachments"
const ATTACHMENT_SIGNED_URL_TTL_SECONDS = 3600
const ATTACHMENT_THUMBNAIL_SIZE = 96

export type IssueStatus =
  | "draft"
  | "todo"
  | "in-progress"
  | "waiting-for-input"
  | "testing"
  | "tests-failed"
  | "ready-for-review"
  | "changes-requested"
  | "approved"
  | "merged"
  | "deploying"
  | "deploy-failed"
  | "validating"
  | "completed"
  | "cancelled"

export type IssueType = "feature" | "bug" | "feedback" | "idea"

export type HomeIssue = {
  id: string
  title: string
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
}

export type IssueDetail = {
  id: string
  title: string
  prompt: string | null
  agent_provider: "claude_code" | "codex"
  type: IssueType
  status: IssueStatus
  run_status: RunStatus
  usage_limit_reset_at: string | null
  pr_url: string | null
  created_at: string
  updated_at: string
  projects: ProjectOption | null
}

export type IssueEdit = Pick<
  IssueDetail,
  "id" | "title" | "prompt" | "agent_provider" | "type"
>

export type HomeData = {
  issues: HomeIssue[]
  blockedIssueIds: string[]
}

export type SettingsData = {
  projects: SettingsProject[]
  githubIntegration: githubIntegrationsService.GithubIntegration | null
  githubAppConfigured: boolean
}

export type IssueDetailData = {
  issue: IssueDetail
  messages: ChatMessage[]
  attachments: Attachment[]
  relations: issuesService.IssueRelation[]
  relationCandidates: issuesService.IssueRelationIssue[]
}

export async function getHomeData(): Promise<HomeData> {
  const { supabase } = await getAuthenticatedContext()
  const { data: issues, error } = await supabase
    .from("issues")
    .select("id,title,status,type,created_at,projects(id,name,repo)")
    .order("created_at", { ascending: false })
    .returns<HomeIssue[]>()

  if (error) {
    throw new Error(error.message)
  }

  const blockedIssueIds = await issuesService.listBlockedIssueIds(
    supabase,
    issues.map((issue) => issue.id)
  )

  return {
    issues,
    blockedIssueIds: Array.from(blockedIssueIds),
  }
}

export async function getSettingsData(): Promise<SettingsData> {
  const { supabase, userId } = await getAuthenticatedContext()
  const [projects, githubIntegration] = await Promise.all([
    projectsService.listProjects(supabase, userId) as Promise<SettingsProject[]>,
    githubIntegrationsService.getGithubIntegration(supabase, userId),
  ])

  return {
    projects,
    githubIntegration,
    githubAppConfigured: Boolean(process.env.GITHUB_APP_SLUG),
  }
}

export async function getNewIssueData(): Promise<{ projects: ProjectOption[] }> {
  const { supabase, userId } = await getAuthenticatedContext()
  const projects = (await projectsService.listProjects(
    supabase,
    userId
  )) as ProjectOption[]

  return { projects }
}

export async function getIssueEditData(id: string): Promise<IssueEdit> {
  const { supabase } = await getAuthenticatedContext()
  const { data: issue, error } = await supabase
    .from("issues")
    .select("id,title,prompt,agent_provider,type")
    .eq("id", id)
    .maybeSingle()
    .returns<IssueEdit | null>()

  if (error) {
    throw new Error(error.message)
  }

  if (!issue) {
    notFound()
  }

  return issue
}

export async function getIssueDetailData(
  id: string
): Promise<IssueDetailData> {
  const { supabase, userId } = await getAuthenticatedContext()
  const { data: issue, error } = await supabase
    .from("issues")
    .select(
      "id,title,prompt,agent_provider,type,status,run_status,usage_limit_reset_at,pr_url,created_at,updated_at,projects(id,name,repo)"
    )
    .eq("id", id)
    .maybeSingle()
    .returns<IssueDetail | null>()

  if (error) {
    throw new Error(error.message)
  }

  if (!issue) {
    notFound()
  }

  const [
    { data: messages, error: messagesError },
    { data: attachmentRows, error: attachmentsError },
    relations,
    relationCandidates,
  ] = await Promise.all([
    supabase
      .from("messages")
      .select("id,role,kind,content,status,created_at")
      .eq("issue_id", id)
      .order("created_at", { ascending: true })
      .returns<ChatMessage[]>(),
    supabase
      .from("attachments")
      .select("id,file_name,content_type,size_bytes,storage_path")
      .eq("issue_id", id)
      .order("created_at", { ascending: true })
      .returns<
        Array<{
          id: string
          file_name: string
          content_type: string | null
          size_bytes: number | null
          storage_path: string
        }>
      >(),
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
    (attachmentRows ?? []).map(async (attachment) => {
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
    issue,
    messages: messages ?? [],
    attachments,
    relations,
    relationCandidates,
  }
}
