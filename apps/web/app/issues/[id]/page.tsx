import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import {
  IconAlertOctagon,
  IconAlertTriangle,
  IconArrowLeft,
  IconCalendar,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconClock,
  IconExternalLink,
  IconEye,
  IconFlask,
  IconFolder,
  IconGitMerge,
  IconLock,
  IconMessage2,
  IconMessageQuestion,
  IconPencil,
  IconRobot,
  IconRocket,
  IconShieldCheck,
  IconThumbUp,
} from "@tabler/icons-react"

import { Button } from "@gentic/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@gentic/ui/card"
import { auth } from "@clerk/nextjs/server"
import { createClient } from "@gentic/supabase/server"
import { cn } from "@gentic/ui/utils"
import * as issuesService from "@gentic/services/issues"

import { IssueStatusSelect } from "./issue-status-select"
import { IssueDeleteButton } from "./issue-delete-button"
import { IssueResetAgentButton } from "./issue-reset-agent-button"
import { Attachments, type Attachment } from "./attachments"
import {
  IssueChat,
  type ChatMessage,
  type RunStatus,
} from "./issue-chat"
import { IssueRelations } from "./issue-relations"

const ATTACHMENTS_BUCKET = "attachments"
const ATTACHMENT_SIGNED_URL_TTL_SECONDS = 3600

type IssueStatus =
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

type Issue = {
  id: string
  title: string
  prompt: string | null
  agent_provider: "claude_code" | "codex"
  status: IssueStatus
  run_status: RunStatus
  pr_url: string | null
  created_at: string
  updated_at: string
  projects: {
    id: string
    name: string
    repo: string
  } | null
}

const statusLabels: Record<IssueStatus, string> = {
  draft: "Draft",
  todo: "Todo",
  "in-progress": "In progress",
  "waiting-for-input": "Waiting for input",
  testing: "Testing",
  "tests-failed": "Tests failed",
  "ready-for-review": "Ready for review",
  "changes-requested": "Changes requested",
  approved: "Approved",
  merged: "Merged",
  deploying: "Deploying",
  "deploy-failed": "Deploy failed",
  validating: "Validating",
  completed: "Completed",
  cancelled: "Cancelled",
}

const statusStyles: Record<IssueStatus, string> = {
  draft: "bg-muted/60 text-muted-foreground",
  todo: "bg-muted text-muted-foreground",
  "in-progress": "bg-primary/15 text-primary-foreground",
  "waiting-for-input": "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  testing: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "tests-failed": "bg-red-500/15 text-red-700 dark:text-red-300",
  "ready-for-review": "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "changes-requested": "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  approved: "bg-teal-500/15 text-teal-700 dark:text-teal-300",
  merged: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  deploying: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  "deploy-failed": "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  validating: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  cancelled: "bg-muted text-muted-foreground",
}

const statusIcons = {
  draft: IconPencil,
  todo: IconCircleDashed,
  "in-progress": IconClock,
  "waiting-for-input": IconMessageQuestion,
  testing: IconFlask,
  "tests-failed": IconAlertTriangle,
  "ready-for-review": IconEye,
  "changes-requested": IconMessage2,
  approved: IconThumbUp,
  merged: IconGitMerge,
  deploying: IconRocket,
  "deploy-failed": IconAlertOctagon,
  validating: IconShieldCheck,
  completed: IconCircleCheck,
  cancelled: IconCircleX,
}

const agentProviderLabels: Record<Issue["agent_provider"], string> = {
  claude_code: "Claude Code",
  codex: "Codex",
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value))
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof IconCalendar
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="truncate text-sm">{value}</p>
      </div>
    </div>
  )
}

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { userId } = await auth()

  if (!userId) {
    redirect("/login")
  }

  const supabase = await createClient()
  const { data: issue, error } = await supabase
    .from("issues")
    .select(
      "id,title,prompt,agent_provider,status,run_status,pr_url,created_at,updated_at,projects(id,name,repo)"
    )
    .eq("id", id)
    .maybeSingle()
    .returns<Issue | null>()

  if (error) {
    throw new Error(error.message)
  }

  if (!issue) {
    notFound()
  }

  const { data: messages, error: messagesError } = await supabase
    .from("messages")
    .select("id,role,kind,content,status,created_at")
    .eq("issue_id", id)
    .order("created_at", { ascending: true })
    .returns<ChatMessage[]>()

  if (messagesError) {
    throw new Error(messagesError.message)
  }

  const { data: attachmentRows, error: attachmentsError } = await supabase
    .from("attachments")
    .select("id,file_name,size_bytes,storage_path")
    .eq("issue_id", id)
    .order("created_at", { ascending: true })
    .returns<
      Array<{
        id: string
        file_name: string
        size_bytes: number | null
        storage_path: string
      }>
    >()

  if (attachmentsError) {
    throw new Error(attachmentsError.message)
  }

  const [relations, relationCandidates] = await Promise.all([
    issuesService.listIssueRelations(supabase, userId, id),
    issuesService.listIssueRelationCandidates(supabase, userId, id),
  ])

  const attachments: Attachment[] = await Promise.all(
    (attachmentRows ?? []).map(async (attachment) => {
      const { data: signed } = await supabase.storage
        .from(ATTACHMENTS_BUCKET)
        .createSignedUrl(
          attachment.storage_path,
          ATTACHMENT_SIGNED_URL_TTL_SECONDS
        )

      return {
        id: attachment.id,
        fileName: attachment.file_name,
        sizeBytes: attachment.size_bytes,
        url: signed?.signedUrl ?? null,
      }
    })
  )

  const StatusIcon = statusIcons[issue.status]
  const isBlocked = relations.some(
    (relation) =>
      relation.target_issue_id === issue.id &&
      relation.source_issue.status !== "completed" &&
      relation.source_issue.status !== "cancelled"
  )

  return (
    <main className="min-h-svh bg-background px-4 py-8 md:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="flex flex-col gap-5 border-b pb-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button asChild variant="ghost" className="w-fit">
              <Link href="/home">
                <IconArrowLeft />
                My issues
              </Link>
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              {issue.pr_url ? (
                <Button asChild variant="outline">
                  <Link href={issue.pr_url} target="_blank" rel="noreferrer">
                    <IconExternalLink />
                    Pull request
                  </Link>
                </Button>
              ) : null}
              <Button asChild variant="outline">
                <Link href={`/issues/${issue.id}/edit`}>
                  <IconPencil />
                  Edit
                </Link>
              </Button>
              <IssueDeleteButton issueId={issue.id} />
            </div>
          </div>
          <div className="grid max-w-4xl gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <div
                className={cn(
                  "inline-flex h-7 w-fit items-center gap-1 rounded-full px-2.5 text-xs font-medium",
                  statusStyles[issue.status]
                )}
              >
                <StatusIcon className="size-3.5" />
                {statusLabels[issue.status]}
              </div>
              {isBlocked ? (
                <div className="inline-flex h-7 w-fit items-center gap-1 rounded-full bg-red-500/15 px-2.5 text-xs font-medium text-red-700 dark:text-red-300">
                  <IconLock className="size-3.5" />
                  Blocked
                </div>
              ) : null}
              <div className="inline-flex h-7 w-fit items-center gap-1 rounded-full bg-muted px-2.5 text-xs font-medium text-muted-foreground">
                <IconRobot className="size-3.5" />
                Agent: {agentProviderLabels[issue.agent_provider]}
              </div>
            </div>
            <h1 className="text-3xl leading-tight md:text-4xl">
              {issue.title}
            </h1>
            <p className="text-sm text-muted-foreground">
              Created {formatDateTime(issue.created_at)}
            </p>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start">
          <div className="grid min-w-0 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Prompt</CardTitle>
                <CardDescription>
                  The request and acceptance details for this issue.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {issue.prompt ? (
                  <div className="rounded-3xl bg-muted/40 p-5">
                    <p className="whitespace-pre-wrap text-base leading-7">
                      {issue.prompt}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No prompt provided.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="grid gap-1.5">
                  <CardTitle>Agent activity</CardTitle>
                  <CardDescription>
                    {agentProviderLabels[issue.agent_provider]} will run this
                    issue when it moves to Todo.
                  </CardDescription>
                </div>
                <IssueResetAgentButton issueId={issue.id} />
              </CardHeader>
              <CardContent>
                <IssueChat
                  issueId={issue.id}
                  initialMessages={messages ?? []}
                  initialRunStatus={issue.run_status}
                  initialPrUrl={issue.pr_url}
                />
              </CardContent>
            </Card>
          </div>

          <aside className="grid gap-4 lg:sticky lg:top-6">
            <Card size="sm">
              <CardHeader>
                <CardTitle>Properties</CardTitle>
                <CardDescription>
                  Update state and review ownership details.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5">
                <IssueStatusSelect issueId={issue.id} status={issue.status} />
                <div className="grid gap-3 border-t pt-5">
                  <DetailRow
                    icon={IconRobot}
                    label="Agent"
                    value={agentProviderLabels[issue.agent_provider]}
                  />
                  <DetailRow
                    icon={IconCalendar}
                    label="Updated"
                    value={formatDateTime(issue.updated_at)}
                  />
                </div>
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader>
                <CardTitle>Project</CardTitle>
                <CardDescription>
                  Repository linked to this issue.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {issue.projects ? (
                  <div className="grid gap-4">
                    <DetailRow
                      icon={IconFolder}
                      label="Project"
                      value={issue.projects.name}
                    />
                    <div className="min-w-0 rounded-3xl bg-muted/40 p-3">
                      <p className="truncate text-sm font-medium">
                        {issue.projects.repo}
                      </p>
                    </div>
                    <Button asChild variant="outline" className="w-full">
                      <Link
                        href={`https://github.com/${issue.projects.repo}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <IconExternalLink />
                        Open repo
                      </Link>
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    This issue is not linked to an available project.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader>
                <CardTitle>Relations</CardTitle>
                <CardDescription>
                  Connect issues that block or depend on this work.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <IssueRelations
                  issueId={issue.id}
                  relations={relations}
                  candidates={relationCandidates}
                />
              </CardContent>
            </Card>

            <Card size="sm">
              <CardHeader>
                <CardTitle>Attachments</CardTitle>
                <CardDescription>
                  Files passed to the agent with your prompt.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Attachments issueId={issue.id} attachments={attachments} />
              </CardContent>
            </Card>
          </aside>
        </section>
      </div>
    </main>
  )
}
