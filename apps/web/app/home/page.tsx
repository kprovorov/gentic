import type { Metadata } from "next"
import { Fragment } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import {
  IconAlertOctagon,
  IconAlertTriangle,
  IconCalendar,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconClock,
  IconFolder,
  IconEye,
  IconFlask,
  IconGitMerge,
  IconLock,
  IconMessage2,
  IconMessageQuestion,
  IconPencil,
  IconPlus,
  IconRocket,
  IconShieldCheck,
  IconThumbUp,
} from "@tabler/icons-react"

import { Button } from "@gentic/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@gentic/ui/card"
import { Table, TableBody, TableCell, TableRow } from "@gentic/ui/table"
import { auth } from "@clerk/nextjs/server"
import { createClient } from "@gentic/supabase/server"
import { cn } from "@gentic/ui/utils"
import * as issuesService from "@gentic/services/issues"

import { RealtimeRefresh } from "@/components/realtime-refresh"

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
  status: IssueStatus
  created_at: string
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

const statusOrder: Record<IssueStatus, number> = {
  "waiting-for-input": 0,
  "tests-failed": 1,
  "changes-requested": 2,
  "deploy-failed": 3,
  "in-progress": 4,
  testing: 5,
  validating: 6,
  deploying: 7,
  "ready-for-review": 8,
  approved: 9,
  draft: 10,
  todo: 11,
  merged: 12,
  completed: 13,
  cancelled: 14,
}

function formatDate(value: string) {
  const date = new Date(value)
  const now = new Date()
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  }).format(date)
}

export const metadata: Metadata = {
  title: "Home",
}

export default async function HomePage() {
  const { userId } = await auth()

  if (!userId) {
    redirect("/login")
  }

  const supabase = await createClient()
  const { data: issues, error } = await supabase
    .from("issues")
    .select("id,title,status,created_at,projects(id,name,repo)")
    .order("created_at", { ascending: false })
    .returns<Issue[]>()

  if (error) {
    throw new Error(error.message)
  }

  issues.sort((a, b) => statusOrder[a.status] - statusOrder[b.status])

  const blockedIssueIds = await issuesService.listBlockedIssueIds(
    supabase,
    issues.map((issue) => issue.id)
  )
  const activeIssueCount = issues.filter(
    (issue) =>
      issue.status !== "completed" &&
      issue.status !== "cancelled" &&
      issue.status !== "merged"
  ).length

  const groups = (Object.keys(statusOrder) as IssueStatus[])
    .sort((a, b) => statusOrder[a] - statusOrder[b])
    .map((status) => ({
      status,
      issues: issues.filter((issue) => issue.status === status),
    }))
    .filter((group) => group.issues.length > 0)

  return (
    <main className="min-h-svh bg-background px-4 py-8 md:px-8">
      <RealtimeRefresh
        channelName="home-issues"
        tables={["issues", "issue_relations"]}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-4 border-b pb-6 md:flex-row md:items-end md:justify-between">
          <div className="grid gap-2">
            <p className="text-sm font-medium text-muted-foreground">Home</p>
            <h1 className="text-3xl">Issues</h1>
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
            <div className="grid gap-3 sm:grid-cols-3">
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground">
                    Total
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-medium tabular-nums">
                    {issues.length}
                  </p>
                </CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground">
                    Active
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-medium tabular-nums">
                    {activeIssueCount}
                  </p>
                </CardContent>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardTitle className="text-sm text-muted-foreground">
                    Blocked
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-medium tabular-nums">
                    {blockedIssueIds.size}
                  </p>
                </CardContent>
              </Card>
            </div>

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

                          return (
                            <TableRow key={issue.id} className="group/row">
                              <TableCell className="w-full px-4 py-4">
                                <Link
                                  href={`/issues/${issue.id}`}
                                  className="grid gap-2"
                                >
                                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                                    <span className="truncate font-medium group-hover/row:text-primary">
                                      {issue.title}
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
    </main>
  )
}
