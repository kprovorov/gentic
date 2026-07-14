"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  IconAlertCircle,
  IconAlertOctagon,
  IconAlertTriangle,
  IconArrowLeft,
  IconBug,
  IconBulb,
  IconCalendar,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconClock,
  IconDownload,
  IconExternalLink,
  IconEye,
  IconFileDescription,
  IconFlask,
  IconFolder,
  IconGitMerge,
  IconLock,
  IconMessage2,
  IconMessageQuestion,
  IconPencil,
  IconPlayerPause,
  IconRobot,
  IconRocket,
  IconShieldCheck,
  IconSparkles,
  IconThumbUp,
} from "@tabler/icons-react"

import {
  getIssueDetailData,
  type IssueDetailData,
} from "@/app/queries"
import { queryKeys } from "@/app/query-keys"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { Button } from "@gentic/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@gentic/ui/card"
import { cn } from "@gentic/ui/utils"
import type { IssueStatus } from "@gentic/validators/issues"

import { Attachments } from "./attachments"
import { IssueAgentSelect } from "./issue-agent-select"
import { IssueChat } from "./issue-chat"
import { IssueDeleteButton } from "./issue-delete-button"
import { IssueRelations } from "./issue-relations"
import { IssueRetryAgentButton } from "./issue-retry-agent-button"
import { IssueStatusSelect } from "./issue-status-select"

const statusLabels: Record<IssueStatus, string> = {
  draft: "Draft",
  todo: "To do",
  queued: "Queued",
  held: "On hold",
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
  "run-failed": "Run failed",
  completed: "Completed",
  cancelled: "Cancelled",
}

const statusStyles: Record<IssueStatus, string> = {
  draft: "bg-muted/60 text-muted-foreground",
  todo: "bg-muted text-muted-foreground",
  queued: "bg-primary/15 text-primary-foreground",
  held: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
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
  "run-failed": "bg-destructive/15 text-destructive",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  cancelled: "bg-muted text-muted-foreground",
}

const statusIcons = {
  draft: IconPencil,
  todo: IconCircleDashed,
  queued: IconDownload,
  held: IconPlayerPause,
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
  "run-failed": IconAlertCircle,
  completed: IconCircleCheck,
  cancelled: IconCircleX,
}

const agentProviderLabels: Record<
  IssueDetailData["issue"]["agent_provider"],
  string
> = {
  claude_code: "Claude Code",
  codex: "Codex",
}

const issueTypeLabels: Record<IssueDetailData["issue"]["type"], string> = {
  issue: "Issue",
  feature: "Feature",
  bug: "Bug",
  feedback: "Feedback",
  idea: "Idea",
}

const issueTypeIcons = {
  issue: IconFileDescription,
  feature: IconSparkles,
  bug: IconBug,
  feedback: IconMessage2,
  idea: IconBulb,
}

const issueTypeStyles: Record<IssueDetailData["issue"]["type"], string> = {
  issue: "bg-muted text-muted-foreground",
  feature: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  bug: "bg-red-500/15 text-red-700 dark:text-red-300",
  feedback: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  idea: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
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

function formatPullRequestLabel(url: string) {
  try {
    const [, owner, repo, , number] = new URL(url).pathname.split("/")
    if (owner && repo && number) {
      return `${owner}/${repo}#${number}`
    }
  } catch {
    // Fall back to a generic label for malformed historical data.
  }

  return "Pull request"
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

export function IssueDetailView({
  issueId,
  initialData,
}: {
  issueId: string
  initialData: IssueDetailData
}) {
  const { data } = useQuery({
    queryKey: queryKeys.issue(issueId),
    queryFn: () => getIssueDetailData(issueId),
    initialData,
  })
  const {
    issue,
    messages,
    attachments,
    pullRequests,
    relations,
    relationCandidates,
  } = data
  const StatusIcon = statusIcons[issue.status]
  const TypeIcon = issueTypeIcons[issue.type]
  const displayedPullRequests =
    pullRequests.length > 0
      ? pullRequests
      : issue.pr_url
        ? [
            {
              id: "legacy-pr-url",
              issue_id: issue.id,
              url: issue.pr_url,
              created_at: issue.updated_at,
            },
          ]
        : []
  const isBlocked = relations.some(
    (relation) =>
      relation.target_issue_id === issue.id &&
      relation.source_issue.status !== "completed" &&
      relation.source_issue.status !== "cancelled"
  )

  return (
    <div className="bg-background px-4 py-8 md:px-8">
      <RealtimeRefresh
        channelName={`issue-${issue.id}-detail`}
        tables={[
          "issues",
          "issue_pull_requests",
          "issue_relations",
          "attachments",
          "messages",
        ]}
        queryKey={queryKeys.issue(issue.id)}
      />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="flex flex-col gap-5 border-b pb-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button asChild variant="ghost" className="w-fit">
              <Link href="/issues">
                <IconArrowLeft />
                Issues
              </Link>
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              {displayedPullRequests.map((pullRequest) => (
                <Button key={pullRequest.id} asChild variant="outline">
                  <Link
                    href={pullRequest.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <IconExternalLink />
                    {formatPullRequestLabel(pullRequest.url)}
                  </Link>
                </Button>
              ))}
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
              <div
                className={cn(
                  "inline-flex h-7 w-fit items-center gap-1 rounded-full px-2.5 text-xs font-medium",
                  issueTypeStyles[issue.type]
                )}
              >
                <TypeIcon className="size-3.5" />
                {issueTypeLabels[issue.type]}
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
            <h1
              className={cn(
                "text-3xl leading-tight md:text-4xl",
                !issue.title && "text-muted-foreground italic"
              )}
            >
              {issue.title ?? "Generating title…"}
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
                    issue when it moves to Queued.
                  </CardDescription>
                </div>
                <IssueRetryAgentButton
                  issueId={issue.id}
                  issuePrompt={issue.prompt}
                />
              </CardHeader>
              <CardContent>
                <IssueChat
                  issueId={issue.id}
                  agentProvider={issue.agent_provider}
                  initialMessages={messages}
                  initialStatus={issue.status}
                  initialUsageLimitResetAt={issue.usage_limit_reset_at}
                  initialPrUrl={issue.pr_url}
                  initialPullRequests={pullRequests}
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
                <IssueAgentSelect
                  issueId={issue.id}
                  agentProvider={issue.agent_provider}
                  disabled={Boolean(issue.run_started_at)}
                />
                <div className="grid gap-3 border-t pt-5">
                  <DetailRow
                    icon={TypeIcon}
                    label="Type"
                    value={issueTypeLabels[issue.type]}
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
    </div>
  )
}
