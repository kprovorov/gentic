import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import {
  IconAlertOctagon,
  IconAlertTriangle,
  IconArrowLeft,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconClock,
  IconExternalLink,
  IconEye,
  IconFlask,
  IconGitMerge,
  IconMessage2,
  IconMessageQuestion,
  IconPencil,
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

import { IssueStatusSelect } from "./issue-status-select"
import { IssueDeleteButton } from "./issue-delete-button"
import { Attachments, type Attachment } from "./attachments"
import {
  IssueChat,
  type ChatMessage,
  type RunStatus,
} from "./issue-chat"
import { IssueRelations } from "./issue-relations"
import * as issuesService from "@/lib/services/issues"

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

  return (
    <main className="min-h-svh bg-background px-4 py-8 md:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-4 border-b pb-6">
          <div className="flex items-center justify-between">
            <Button asChild variant="ghost" className="w-fit">
              <Link href="/home">
                <IconArrowLeft />
                Back
              </Link>
            </Button>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline">
                <Link href={`/issues/${issue.id}/edit`}>
                  <IconPencil />
                  Edit
                </Link>
              </Button>
              <IssueDeleteButton issueId={issue.id} />
            </div>
          </div>
          <div className="grid gap-3">
            <div
              className={cn(
                "inline-flex h-7 w-fit items-center gap-1 rounded-full px-2.5 text-xs font-medium",
                statusStyles[issue.status]
              )}
            >
              <StatusIcon className="size-3.5" />
              {statusLabels[issue.status]}
            </div>
            <h1 className="text-3xl">{issue.title}</h1>
          </div>
        </header>

        <section className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
              <CardDescription>
                Update where this issue stands.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <IssueStatusSelect issueId={issue.id} status={issue.status} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Agent</CardTitle>
              <CardDescription>
                {agentProviderLabels[issue.agent_provider]} will run this issue
                when it moves to Todo.
              </CardDescription>
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

          <Card>
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

          <Card>
            <CardHeader>
              <CardTitle>Attachments</CardTitle>
              <CardDescription>
                Files attached here are passed to the agent along with your
                prompt.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Attachments issueId={issue.id} attachments={attachments} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Prompt</CardTitle>
              <CardDescription>
                Created {formatDateTime(issue.created_at)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {issue.prompt ? (
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                  {issue.prompt}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No prompt provided.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Project</CardTitle>
              <CardDescription>
                Last updated {formatDateTime(issue.updated_at)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {issue.projects ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">{issue.projects.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {issue.projects.repo}
                    </p>
                  </div>
                  <Button asChild variant="outline">
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
        </section>
      </div>
    </main>
  )
}
