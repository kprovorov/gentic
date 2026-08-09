"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconAlertOctagon,
  IconArrowBarToRight,
  IconArrowsSort,
  IconBug,
  IconBulb,
  IconCheck,
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
  IconMinus,
  IconPencil,
  IconPlayerPause,
  IconRocket,
  IconShieldCheck,
  IconSparkles,
  IconThumbUp,
  IconTrendingDown,
  IconTrendingUp,
} from "@tabler/icons-react"
import { toast } from "sonner"

import type { HomeIssue, IssuesData } from "@/app/queries"
import { queryKeys } from "@/app/query-keys"
import { getIssueHref } from "@/app/issues/urls"
import { pullRequestStateMeta } from "@/app/issues/pull-request-state-meta"
import { AgentProviderIcon, BrandIcon } from "@/components/agent-provider-icon"
import { Button } from "@gentic/ui/button"
import { Checkbox } from "@gentic/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@gentic/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@gentic/ui/tooltip"
import { cn } from "@gentic/ui/utils"
import { IssueLabelChips } from "./issue-label-chips"
import {
  issuePriorityLabels,
  issuePriorityOptions,
  issuePriorityOrder,
  type AgentProvider,
  type IssuePriority,
  type IssueStatus,
  type IssueType,
} from "@gentic/validators/issues"

import { updateIssuePriority, updateIssueStatus } from "./actions"
import { agentProviderLabels } from "./agent-provider-options"
import { updateIssuesInCaches } from "./issues-cache"

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

export const statusStyles: Record<IssueStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  todo: "bg-muted text-muted-foreground",
  queued: "bg-muted text-muted-foreground",
  held: "bg-muted text-muted-foreground",
  "in-progress": "bg-muted text-muted-foreground",
  "waiting-for-input": "bg-muted text-muted-foreground",
  testing: "bg-muted text-muted-foreground",
  "tests-failed": "bg-muted text-muted-foreground",
  "ready-for-review": "bg-muted text-muted-foreground",
  "changes-requested": "bg-muted text-muted-foreground",
  approved: "bg-muted text-muted-foreground",
  merged: "bg-muted text-muted-foreground",
  deploying: "bg-muted text-muted-foreground",
  "deploy-failed": "bg-muted text-muted-foreground",
  validating: "bg-muted text-muted-foreground",
  "run-failed": "bg-muted text-muted-foreground",
  completed: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
}

export const statusIconStyles: Record<IssueStatus, string> = {
  draft: "text-muted-foreground",
  todo: "text-muted-foreground",
  queued: "text-primary",
  held: "text-amber-600 dark:text-amber-300",
  "in-progress": "text-blue-600 dark:text-blue-300",
  "waiting-for-input": "text-amber-600 dark:text-amber-300",
  testing: "text-sky-600 dark:text-sky-300",
  "tests-failed": "text-red-600 dark:text-red-300",
  "ready-for-review": "text-violet-600 dark:text-violet-300",
  "changes-requested": "text-orange-600 dark:text-orange-300",
  approved: "text-teal-600 dark:text-teal-300",
  merged: "text-indigo-600 dark:text-indigo-300",
  deploying: "text-blue-600 dark:text-blue-300",
  "deploy-failed": "text-rose-600 dark:text-rose-300",
  validating: "text-cyan-600 dark:text-cyan-300",
  "run-failed": "text-destructive",
  completed: "text-emerald-600 dark:text-emerald-300",
  cancelled: "text-muted-foreground",
}

export const statusIcons = {
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

export const statusOptions: { value: IssueStatus; label: string }[] = [
  { value: "draft", label: statusLabels.draft },
  { value: "todo", label: statusLabels.todo },
  { value: "queued", label: statusLabels.queued },
  { value: "held", label: statusLabels.held },
  { value: "in-progress", label: statusLabels["in-progress"] },
  { value: "waiting-for-input", label: statusLabels["waiting-for-input"] },
  { value: "testing", label: statusLabels.testing },
  { value: "tests-failed", label: statusLabels["tests-failed"] },
  { value: "ready-for-review", label: statusLabels["ready-for-review"] },
  { value: "changes-requested", label: statusLabels["changes-requested"] },
  { value: "approved", label: statusLabels.approved },
  { value: "merged", label: statusLabels.merged },
  { value: "deploying", label: statusLabels.deploying },
  { value: "deploy-failed", label: statusLabels["deploy-failed"] },
  { value: "validating", label: statusLabels.validating },
  { value: "run-failed", label: statusLabels["run-failed"] },
  { value: "completed", label: statusLabels.completed },
  { value: "cancelled", label: statusLabels.cancelled },
]

export const issueTypeLabels: Record<IssueType, string> = {
  issue: "Issue",
  feature: "Feature",
  bug: "Bug",
  feedback: "Feedback",
  idea: "Idea",
}

export const issueTypeIcons = {
  issue: IconFileDescription,
  feature: IconSparkles,
  bug: IconBug,
  feedback: IconMessage2,
  idea: IconBulb,
}

export const issueTypeStyles: Record<IssueType, string> = {
  issue: "bg-muted text-muted-foreground",
  feature: "bg-muted text-muted-foreground",
  bug: "bg-muted text-muted-foreground",
  feedback: "bg-muted text-muted-foreground",
  idea: "bg-muted text-muted-foreground",
}

export const issueTypeIconStyles: Record<IssueType, string> = {
  issue: "text-muted-foreground",
  feature: "text-violet-600 dark:text-violet-300",
  bug: "text-red-600 dark:text-red-300",
  feedback: "text-sky-600 dark:text-sky-300",
  idea: "text-amber-600 dark:text-amber-300",
}

export function IssueTypeBadge({ type }: { type: IssueType }) {
  const TypeIcon = issueTypeIcons[type]

  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium",
        issueTypeStyles[type]
      )}
    >
      <TypeIcon className={cn("size-3.5", issueTypeIconStyles[type])} />
      <span className="whitespace-nowrap">{issueTypeLabels[type]}</span>
    </span>
  )
}

export function AgentProviderBadge({ provider }: { provider: AgentProvider }) {
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-muted px-2 text-xs font-medium text-muted-foreground">
      <AgentProviderIcon provider={provider} className="size-3.5" />
      <span className="whitespace-nowrap">
        {agentProviderLabels[provider]}
      </span>
    </span>
  )
}

export function RepoBadge({
  repo,
  className,
}: {
  repo: string
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-full shrink-0 items-center gap-1 rounded-full bg-muted px-2 text-xs font-medium text-muted-foreground",
        className
      )}
    >
      <BrandIcon name="github" className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{repo}</span>
    </span>
  )
}

export const blockingBadgeStyles = {
  blocked: "bg-muted text-muted-foreground",
  blocking: "bg-muted text-muted-foreground",
} as const

export const blockingIconStyles = {
  blocked: "text-red-600 dark:text-red-300",
  blocking: "text-amber-600 dark:text-amber-300",
} as const

function getPullRequestLabel(url: string) {
  try {
    const [, owner, repo, resource, number] = new URL(url).pathname.split("/")
    if (owner && repo && resource === "pull" && number) {
      return {
        short: `#${number}`,
        full: `${owner}/${repo}#${number}`,
      }
    }
  } catch {
    // Fall back to a generic label for malformed historical data.
  }

  return { short: "#", full: "Pull request" }
}

export function PullRequestPills({
  pullRequests,
}: {
  pullRequests: HomeIssue["pullRequests"]
}) {
  if (pullRequests.length === 0) {
    return null
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {pullRequests.map((pullRequest) => {
        const label = getPullRequestLabel(pullRequest.url)
        const stateMeta = pullRequestStateMeta[pullRequest.state ?? "unknown"]
        const StateIcon = stateMeta.icon

        return (
          <Tooltip key={pullRequest.id}>
            <TooltipTrigger asChild>
              <Link
                href={pullRequest.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${label.full}`}
                className={cn(
                  "inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium transition-[color,box-shadow,background-color] hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
                  stateMeta.className
                )}
              >
                <StateIcon
                  className={cn("size-3.5", stateMeta.iconClassName)}
                />
                <span className="whitespace-nowrap">{label.short}</span>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="top">
              {label.full} · {stateMeta.label}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

export const issueTypeOptions: { value: IssueType; label: string }[] = [
  { value: "issue", label: issueTypeLabels.issue },
  { value: "feature", label: issueTypeLabels.feature },
  { value: "bug", label: issueTypeLabels.bug },
  { value: "feedback", label: issueTypeLabels.feedback },
  { value: "idea", label: issueTypeLabels.idea },
]

function IssueIndicatorBadge({
  label,
  className,
  children,
}: {
  label: string
  className: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={label}
          className={cn(
            "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
            className
          )}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

export const priorityIconStyles: Record<IssuePriority, string> = {
  low: "text-gray-600 dark:text-gray-300",
  medium: "text-blue-600 dark:text-blue-300",
  high: "text-amber-600 dark:text-amber-300",
  urgent: "text-red-600 dark:text-red-300",
}

export const priorityIcons = {
  low: IconTrendingDown,
  medium: IconMinus,
  high: IconTrendingUp,
  urgent: IconAlertTriangle,
} satisfies Record<IssuePriority, typeof IconAlertTriangle>

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

export function IssueStatusMenu({
  issue,
  showLabel = false,
}: {
  issue: Pick<HomeIssue, "id" | "status">
  showLabel?: boolean
}) {
  const queryClient = useQueryClient()
  const StatusIcon = statusIcons[issue.status]
  const mutation = useMutation({
    mutationFn: updateIssueStatus,
    onMutate: async (formData) => {
      const nextStatus = formData.get("status")

      if (typeof nextStatus !== "string") {
        return
      }

      await Promise.all([
        queryClient.cancelQueries({ queryKey: queryKeys.issues }),
        queryClient.cancelQueries({ queryKey: queryKeys.home }),
      ])

      const previousIssues = queryClient.getQueryData<IssuesData>(
        queryKeys.issues
      )
      const previousHome = queryClient.getQueryData<IssuesData>(queryKeys.home)
      const updateData = (current: IssuesData | undefined) =>
        current
          ? {
              ...current,
              issues: current.issues.map((currentIssue) =>
                currentIssue.id === issue.id
                  ? {
                      ...currentIssue,
                      status: nextStatus as HomeIssue["status"],
                    }
                  : currentIssue
              ),
            }
          : current

      queryClient.setQueryData(queryKeys.issues, updateData)
      queryClient.setQueryData(queryKeys.home, updateData)

      return { previousHome, previousIssues }
    },
    onError: (_error, _formData, context) => {
      if (context?.previousIssues) {
        queryClient.setQueryData(queryKeys.issues, context.previousIssues)
      }

      if (context?.previousHome) {
        queryClient.setQueryData(queryKeys.home, context.previousHome)
      }

      toast.error("Failed to update issue status")
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues }),
      ])
    },
  })

  function selectStatus(nextStatus: HomeIssue["status"]) {
    if (nextStatus === issue.status || mutation.isPending) {
      return
    }

    const formData = new FormData()
    formData.set("id", issue.id)
    formData.set("status", nextStatus)
    mutation.mutate(formData)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={mutation.isPending}
          aria-label={`Change status from ${statusLabels[issue.status]}`}
          className={cn(
            "inline-flex h-7 shrink-0 items-center justify-center rounded-full transition-[color,box-shadow,background-color] hover:ring-2 hover:ring-ring/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=open]:ring-2 data-[state=open]:ring-ring/30",
            showLabel ? "gap-1.5 px-2.5 text-xs font-medium" : "w-7",
            statusStyles[issue.status]
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <StatusIcon
            className={cn("size-3.5 shrink-0", statusIconStyles[issue.status])}
          />
          {showLabel ? (
            <span className="whitespace-nowrap">
              {statusLabels[issue.status]}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-60 rounded-lg bg-popover before:hidden"
      >
        {statusOptions.map((option) => {
          const OptionIcon = statusIcons[option.value]
          const isSelected = option.value === issue.status

          return (
            <DropdownMenuItem
              key={option.value}
              disabled={mutation.isPending}
              onSelect={() => selectStatus(option.value)}
              className="gap-3"
            >
              <OptionIcon
                className={cn("size-4", statusIconStyles[option.value])}
              />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {isSelected ? <IconCheck className="size-4" /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function IssuePriorityMenu({
  issue,
  showLabel = false,
}: {
  issue: Pick<HomeIssue, "id" | "priority">
  showLabel?: boolean
}) {
  const queryClient = useQueryClient()
  const PriorityIcon = priorityIcons[issue.priority]
  const mutation = useMutation({
    mutationFn: updateIssuePriority,
    onMutate: async (formData) => {
      const nextPriority = formData.get("priority")

      if (typeof nextPriority !== "string") {
        return
      }

      await Promise.all([
        queryClient.cancelQueries({ queryKey: queryKeys.issues }),
        queryClient.cancelQueries({ queryKey: queryKeys.home }),
      ])

      const previousIssues = queryClient.getQueryData<IssuesData>(
        queryKeys.issues
      )
      const previousHome = queryClient.getQueryData<IssuesData>(queryKeys.home)

      updateIssuesInCaches(
        queryClient,
        (currentIssue) => currentIssue.id === issue.id,
        (currentIssue) => ({
          ...currentIssue,
          priority: nextPriority as HomeIssue["priority"],
        })
      )

      return { previousHome, previousIssues }
    },
    onError: (_error, _formData, context) => {
      if (context?.previousIssues) {
        queryClient.setQueryData(queryKeys.issues, context.previousIssues)
      }

      if (context?.previousHome) {
        queryClient.setQueryData(queryKeys.home, context.previousHome)
      }

      toast.error("Failed to update issue priority")
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues }),
      ])
    },
  })

  function selectPriority(nextPriority: HomeIssue["priority"]) {
    if (nextPriority === issue.priority || mutation.isPending) {
      return
    }

    const formData = new FormData()
    formData.set("id", issue.id)
    formData.set("priority", nextPriority)
    mutation.mutate(formData)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={mutation.isPending}
          aria-label={`Change priority from ${
            issuePriorityLabels[issue.priority]
          }`}
          className={cn(
            "inline-flex h-6 shrink-0 items-center justify-center self-start rounded-full bg-muted text-muted-foreground transition-[color,box-shadow,background-color] hover:ring-2 hover:ring-ring/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=open]:ring-2 data-[state=open]:ring-ring/30",
            showLabel ? "gap-1 px-2 text-xs font-medium" : "w-6"
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <PriorityIcon
            className={cn(
              "size-3.5 shrink-0",
              priorityIconStyles[issue.priority]
            )}
          />
          {showLabel ? (
            <span className="whitespace-nowrap">
              {issuePriorityLabels[issue.priority]}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-52 rounded-lg bg-popover before:hidden"
      >
        {issuePriorityOptions.map((option) => {
          const OptionIcon = priorityIcons[option.value]
          const isSelected = option.value === issue.priority

          return (
            <DropdownMenuItem
              key={option.value}
              disabled={mutation.isPending}
              onSelect={() => selectPriority(option.value)}
              className="gap-3"
            >
              <OptionIcon
                className={cn("size-4", priorityIconStyles[option.value])}
              />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {isSelected ? <IconCheck className="size-4" /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function getIssuesColumns(
  blockedIssueIds: Set<string>,
  blockingIssueIds: Set<string>,
  selectedLabelIds: Set<string> = new Set(),
  onLabelSelect: (labelId: string) => void = () => undefined
): ColumnDef<HomeIssue>[] {
  return [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected()
              ? true
              : table.getIsSomePageRowsSelected()
                ? "indeterminate"
                : false
          }
          onCheckedChange={(value) =>
            table.toggleAllPageRowsSelected(value === true)
          }
          onClick={(event) => event.stopPropagation()}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(value === true)}
          onClick={(event) => event.stopPropagation()}
          aria-label="Select row"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: "code",
      header: ({ column }) => <SortableHeader label="Code" column={column} />,
      cell: ({ row }) => (
        <span className="font-mono text-xs font-semibold text-muted-foreground">
          {row.original.code ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "title",
      header: ({ column }) => <SortableHeader label="Issue" column={column} />,
      cell: ({ row }) => {
        const issue = row.original
        const issueHref = getIssueHref(issue) ?? "/issues"

        return (
          <Link href={issueHref} className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                "truncate font-medium hover:text-primary",
                !issue.title && "text-muted-foreground italic"
              )}
            >
              {issue.title ?? "Generating title…"}
            </span>
          </Link>
        )
      },
    },
    {
      id: "type",
      accessorFn: (issue) => issueTypeLabels[issue.type],
      header: ({ column }) => <SortableHeader label="Type" column={column} />,
      cell: ({ row }) => <IssueTypeBadge type={row.original.type} />,
    },
    {
      id: "agent_provider",
      accessorFn: (issue) => agentProviderLabels[issue.agent_provider],
      header: ({ column }) => <SortableHeader label="Agent" column={column} />,
      cell: ({ row }) => (
        <AgentProviderBadge provider={row.original.agent_provider} />
      ),
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
      id: "labels",
      header: "Labels",
      cell: ({ row }) => (
        <IssueLabelChips
          labels={row.original.labels}
          selectedLabelIds={selectedLabelIds}
          onLabelSelect={onLabelSelect}
        />
      ),
      enableSorting: false,
    },
    {
      accessorKey: "status",
      header: ({ column }) => <SortableHeader label="Status" column={column} />,
      sortingFn: (rowA, rowB) =>
        statusOrder[rowA.original.status] - statusOrder[rowB.original.status],
      cell: ({ row }) => <IssueStatusMenu issue={row.original} showLabel />,
    },
    {
      accessorKey: "priority",
      header: ({ column }) => (
        <SortableHeader label="Priority" column={column} />
      ),
      sortingFn: (rowA, rowB) =>
        issuePriorityOrder[rowA.original.priority] -
        issuePriorityOrder[rowB.original.priority],
      cell: ({ row }) => <IssuePriorityMenu issue={row.original} showLabel />,
    },
    {
      id: "blocked",
      accessorFn: (issue) => blockedIssueIds.has(issue.id),
      header: ({ column }) => (
        <SortableHeader label="Blocked" column={column} />
      ),
      cell: ({ row }) =>
        blockedIssueIds.has(row.original.id) ? (
          <IssueIndicatorBadge
            label="Blocked"
            className={blockingBadgeStyles.blocked}
          >
            <IconLock className={cn("size-3.5", blockingIconStyles.blocked)} />
          </IssueIndicatorBadge>
        ) : null,
    },
    {
      id: "blocking",
      accessorFn: (issue) => blockingIssueIds.has(issue.id),
      header: ({ column }) => (
        <SortableHeader label="Blocking" column={column} />
      ),
      cell: ({ row }) =>
        blockingIssueIds.has(row.original.id) ? (
          <IssueIndicatorBadge
            label="Blocking"
            className={blockingBadgeStyles.blocking}
          >
            <IconArrowBarToRight
              className={cn("size-3.5", blockingIconStyles.blocking)}
            />
          </IssueIndicatorBadge>
        ) : null,
    },
    {
      id: "pullRequests",
      header: "Pull requests",
      cell: ({ row }) => (
        <PullRequestPills pullRequests={row.original.pullRequests} />
      ),
      enableSorting: false,
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
