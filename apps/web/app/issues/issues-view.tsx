"use client"

import { Fragment } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  IconAlertCircle,
  IconAlertOctagon,
  IconAlertTriangle,
  IconBug,
  IconBulb,
  IconCalendar,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconClock,
  IconDownload,
  IconEye,
  IconFlask,
  IconFolder,
  IconGitMerge,
  IconLock,
  IconMessage2,
  IconMessageQuestion,
  IconPencil,
  IconPlayerPause,
  IconPlus,
  IconRocket,
  IconShieldCheck,
  IconSparkles,
  IconThumbUp,
} from "@tabler/icons-react"

import {
  getIssuesData,
  type IssuesData,
  type IssueStatus,
  type IssueType,
} from "@/app/queries"
import { queryKeys } from "@/app/query-keys"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { Button } from "@gentic/ui/button"
import { Table, TableBody, TableCell, TableRow } from "@gentic/ui/table"
import { cn } from "@gentic/ui/utils"

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

const issueTypeLabels: Record<IssueType, string> = {
  feature: "Feature",
  bug: "Bug",
  feedback: "Feedback",
  idea: "Idea",
}

const issueTypeIcons = {
  feature: IconSparkles,
  bug: IconBug,
  feedback: IconMessage2,
  idea: IconBulb,
}

const issueTypeStyles: Record<IssueType, string> = {
  feature: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  bug: "bg-red-500/15 text-red-700 dark:text-red-300",
  feedback: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  idea: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
}

const statusOrder: Record<IssueStatus, number> = {
  "waiting-for-input": 0,
  "tests-failed": 1,
  "changes-requested": 2,
  "deploy-failed": 3,
  "run-failed": 4,
  held: 5,
  "in-progress": 6,
  queued: 7,
  testing: 8,
  validating: 9,
  deploying: 10,
  "ready-for-review": 11,
  approved: 12,
  draft: 13,
  todo: 14,
  merged: 15,
  completed: 16,
  cancelled: 17,
}

function formatDate(value: string) {
  const date = new Date(value)
  const now = new Date()
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  }).format(date)
}

export function IssuesView({ initialData }: { initialData: IssuesData }) {
  const { data } = useQuery({
    queryKey: queryKeys.issues,
    queryFn: getIssuesData,
    initialData,
  })
  const issues = [...data.issues].sort(
    (a, b) => statusOrder[a.status] - statusOrder[b.status]
  )
  const blockedIssueIds = new Set(data.blockedIssueIds)
  const groups = (Object.keys(statusOrder) as IssueStatus[])
    .sort((a, b) => statusOrder[a] - statusOrder[b])
    .map((status) => ({
      status,
      issues: issues.filter((issue) => issue.status === status),
    }))
    .filter((group) => group.issues.length > 0)

  return (
    <div className="bg-background px-4 py-8 md:px-8">
      <RealtimeRefresh
        channelName="issues-list"
        tables={["issues", "issue_relations"]}
        queryKey={queryKeys.issues}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-4 border-b pb-6 md:flex-row md:items-end md:justify-between">
          <div className="grid gap-2">
            <p className="text-sm font-medium text-muted-foreground">Issues</p>
            <h1 className="text-3xl">All issues</h1>
            <p className="text-sm text-muted-foreground">
              Track agent work, blockers, and recent project activity.
            </p>
          </div>
          <Button asChild>
            <Link href="/issues/new">
              <IconPlus />
              New issue
            </Link>
          </Button>
        </header>

        {issues.length === 0 ? (
          <section className="flex min-h-72 flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-8 text-center">
            <div className="grid gap-1">
              <h2 className="text-xl">No issues yet</h2>
              <p className="max-w-md text-sm text-muted-foreground">
                Create an issue and attach it to one of your projects.
              </p>
            </div>
            <Button asChild variant="outline">
              <Link href="/issues/new">
                <IconPlus />
                Create issue
              </Link>
            </Button>
          </section>
        ) : (
          <section className="grid gap-4">
            <div className="overflow-hidden rounded-4xl border bg-card shadow-sm">
              <Table>
                <TableBody>
                  {groups.map((group) => {
                    const GroupIcon = statusIcons[group.status]

                    return (
                      <Fragment key={group.status}>
                        <TableRow className="bg-muted/50 hover:bg-muted/50">
                          <TableCell colSpan={2} className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "inline-flex size-6 items-center justify-center rounded-full",
                                  statusStyles[group.status]
                                )}
                              >
                                <GroupIcon className="size-3.5" />
                              </span>
                              <span className="text-sm font-medium">
                                {statusLabels[group.status]}
                              </span>
                              <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">
                                {group.issues.length}
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                        {group.issues.map((issue) => {
                          const isBlocked = blockedIssueIds.has(issue.id)
                          const TypeIcon = issueTypeIcons[issue.type]

                          return (
                            <TableRow key={issue.id} className="group/row">
                              <TableCell className="w-full px-4 py-4">
                                <Link
                                  href={`/issues/${issue.id}`}
                                  className="grid gap-2"
                                >
                                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <span
                                      className={cn(
                                        "truncate font-medium group-hover/row:text-primary",
                                        !issue.title &&
                                          "text-muted-foreground italic"
                                      )}
                                    >
                                      {issue.title ?? "Generating title…"}
                                    </span>
                                    <span
                                      className={cn(
                                        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                                        issueTypeStyles[issue.type]
                                      )}
                                    >
                                      <TypeIcon className="size-3" />
                                      {issueTypeLabels[issue.type]}
                                    </span>
                                    {isBlocked ? (
                                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
                                        <IconLock className="size-3" />
                                        Blocked
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                                    <span className="inline-flex min-w-0 items-center gap-1.5">
                                      <IconFolder className="size-3.5 shrink-0" />
                                      <span className="truncate">
                                        {issue.projects?.name ??
                                          "Unknown project"}
                                      </span>
                                    </span>
                                    <span className="inline-flex items-center gap-1.5">
                                      <IconCalendar className="size-3.5" />
                                      {formatDate(issue.created_at)}
                                    </span>
                                  </div>
                                </Link>
                              </TableCell>
                              <TableCell className="hidden px-4 py-4 text-right text-sm text-muted-foreground md:table-cell">
                                {issue.projects?.repo ?? ""}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
