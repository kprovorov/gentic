import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"
import {
  IconAlertCircle,
  IconAlertOctagon,
  IconAlertTriangle,
  IconArrowsSort,
  IconBug,
  IconBulb,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconClock,
  IconDownload,
  IconEye,
  IconFileDescription,
  IconFlask,
  IconGitMerge,
  IconLock,
  IconMessage2,
  IconMessageQuestion,
  IconPencil,
  IconPlayerPause,
  IconRocket,
  IconShieldCheck,
  IconSparkles,
  IconThumbUp,
} from "@tabler/icons-react"

import type { HomeIssue, IssueStatus, IssueType } from "@/app/queries"
import { Button } from "@gentic/ui/button"
import { cn } from "@gentic/ui/utils"

export const statusLabels: Record<IssueStatus, string> = {
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

export const statusOrder: Record<IssueStatus, number> = {
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

const issueTypeLabels: Record<IssueType, string> = {
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

const issueTypeStyles: Record<IssueType, string> = {
  issue: "bg-muted text-muted-foreground",
  feature: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  bug: "bg-red-500/15 text-red-700 dark:text-red-300",
  feedback: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  idea: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
}

export function formatDate(value: string) {
  const date = new Date(value)
  const now = new Date()
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  }).format(date)
}

function SortableHeader({
  label,
  column,
}: {
  label: string
  column: {
    toggleSorting: (desc?: boolean) => void
    getIsSorted: () => false | "asc" | "desc"
  }
}) {
  return (
    <Button
      variant="ghost"
      className="-ml-3 h-8"
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
    >
      {label}
      <IconArrowsSort className="size-3.5" />
    </Button>
  )
}

export function getIssuesColumns(
  blockedIssueIds: Set<string>
): ColumnDef<HomeIssue>[] {
  return [
    {
      accessorKey: "title",
      header: ({ column }) => <SortableHeader label="Issue" column={column} />,
      cell: ({ row }) => {
        const issue = row.original
        const TypeIcon = issueTypeIcons[issue.type]
        const isBlocked = blockedIssueIds.has(issue.id)

        return (
          <Link
            href={`/issues/${issue.id}`}
            className="flex min-w-0 flex-wrap items-center gap-2"
          >
            <span
              className={cn(
                "truncate font-medium hover:text-primary",
                !issue.title && "text-muted-foreground italic"
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
          </Link>
        )
      },
    },
    {
      id: "project",
      accessorFn: (issue) => issue.projects?.name ?? "Unknown project",
      header: ({ column }) => (
        <SortableHeader label="Project" column={column} />
      ),
      cell: ({ row }) => (
        <span className="truncate text-sm text-muted-foreground">
          {row.original.projects?.name ?? "Unknown project"}
        </span>
      ),
    },
    {
      id: "repo",
      accessorFn: (issue) => issue.projects?.repo ?? "",
      header: "Repository",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.projects?.repo ?? ""}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: ({ column }) => (
        <SortableHeader label="Status" column={column} />
      ),
      sortingFn: (rowA, rowB) =>
        statusOrder[rowA.original.status] - statusOrder[rowB.original.status],
      cell: ({ row }) => {
        const status = row.original.status
        const StatusIcon = statusIcons[status]

        return (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
              statusStyles[status]
            )}
          >
            <StatusIcon className="size-3.5" />
            {statusLabels[status]}
          </span>
        )
      },
    },
    {
      accessorKey: "created_at",
      header: ({ column }) => (
        <SortableHeader label="Created" column={column} />
      ),
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(row.original.created_at)}
        </span>
      ),
    },
  ]
}
