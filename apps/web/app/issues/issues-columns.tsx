"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import type { ColumnDef } from "@tanstack/react-table"
import {
  IconAlertTriangle,
  IconArrowBarToRight,
  IconArrowsSort,
  IconBug,
  IconBulb,
  IconCheck,
  IconFileDescription,
  IconLock,
  IconMessage2,
  IconMinus,
  IconSparkles,
  IconTrendingDown,
  IconTrendingUp,
} from "@tabler/icons-react"

import type { HomeIssue } from "@/app/queries"
import { getIssueHref } from "@/app/issues/urls"
import { pullRequestStateMeta } from "@/app/issues/pull-request-state-meta"
import { AgentProviderIcon, BrandIcon } from "@/components/agent-provider-icon"
import { Button } from "@gentic/ui/button"
import { Checkbox } from "@gentic/ui/checkbox"
import { Pill, PillButton, PillLabel } from "@gentic/ui/pill"
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
  issueTypeSchema,
  type AgentProvider,
  type IssuePriority,
  type IssueType,
} from "@gentic/validators/issues"

import {
  updateIssuePriority,
  updateIssueStatus,
  updateIssueType,
} from "./actions"
import { agentProviderLabels } from "./agent-provider-options"
import { useIssueFieldMutation } from "./use-issue-field-mutation"
import {
  statusIconStyles,
  statusIcons,
  statusLabels,
  statusOptions,
  statusOrder,
} from "./issue-status-meta"

export {
  statusIconStyles,
  statusIcons,
  statusLabels,
  statusOptions,
  statusOrder,
  statusStyles,
} from "./issue-status-meta"

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

export const issueTypeIconStyles: Record<IssueType, string> = {
  issue: "text-muted-foreground",
  feature: "text-violet-600 dark:text-violet-300",
  bug: "text-red-600 dark:text-red-300",
  feedback: "text-sky-600 dark:text-sky-300",
  idea: "text-amber-600 dark:text-amber-300",
}

export function AgentProviderBadge({ provider }: { provider: AgentProvider }) {
  return (
    <Pill>
      <AgentProviderIcon provider={provider} />
      <PillLabel>{agentProviderLabels[provider]}</PillLabel>
    </Pill>
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
    <Pill className={className}>
      <BrandIcon name="github" />
      <PillLabel>{repo}</PillLabel>
    </Pill>
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
              <PillButton asChild>
                <Link
                  href={pullRequest.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${label.full}`}
                >
                  <StateIcon className={stateMeta.iconClassName} />
                  <PillLabel>{label.short}</PillLabel>
                </Link>
              </PillButton>
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

export const issueTypeOptions = issueTypeSchema.options.map((value) => ({
  value,
  label: issueTypeLabels[value],
}))

export function IssueIndicatorBadge({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Pill size="icon-xs" tabIndex={0} aria-label={label}>
          {children}
        </Pill>
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

type IssueFieldIcon = typeof IconCheck

/**
 * The option list shared by the status, priority, and type dropdown menus: an
 * icon, the label, and a check on whatever the issue is currently set to.
 */
function IssueFieldOptions<Value extends string>({
  options,
  icons,
  iconStyles,
  value,
  disabled,
  onSelect,
}: {
  options: readonly { value: Value; label: string }[]
  icons: Record<Value, IssueFieldIcon>
  iconStyles: Record<Value, string>
  value: Value
  disabled: boolean
  onSelect: (value: Value) => void
}) {
  return options.map((option) => {
    // Annotated because indexing a generic Record leaves TS with an unresolved
    // indexed-access type that JSX can't accept props against.
    const OptionIcon: IssueFieldIcon = icons[option.value]

    return (
      <DropdownMenuItem
        key={option.value}
        disabled={disabled}
        onSelect={() => onSelect(option.value)}
        className="gap-3"
      >
        <OptionIcon className={cn("size-4", iconStyles[option.value])} />
        <span className="min-w-0 flex-1 truncate">{option.label}</span>
        {option.value === value ? <IconCheck className="size-4" /> : null}
      </DropdownMenuItem>
    )
  })
}

export function IssueStatusMenu({
  issue,
  showLabel = false,
}: {
  issue: Pick<HomeIssue, "id" | "status">
  showLabel?: boolean
}) {
  const StatusIcon = statusIcons[issue.status]
  const { isPending, select } = useIssueFieldMutation({
    issueId: issue.id,
    field: "status",
    value: issue.status,
    action: updateIssueStatus,
    errorMessage: "Failed to update issue status",
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PillButton
          size={showLabel ? "xs" : "icon-xs"}
          disabled={isPending}
          aria-label={`Change status from ${statusLabels[issue.status]}`}
          onClick={(event) => event.stopPropagation()}
        >
          <StatusIcon className={statusIconStyles[issue.status]} />
          {showLabel ? (
            <PillLabel>{statusLabels[issue.status]}</PillLabel>
          ) : null}
        </PillButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-60 rounded-lg bg-popover before:hidden"
      >
        <IssueFieldOptions
          options={statusOptions}
          icons={statusIcons}
          iconStyles={statusIconStyles}
          value={issue.status}
          disabled={isPending}
          onSelect={select}
        />
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
  const PriorityIcon = priorityIcons[issue.priority]
  const { isPending, select } = useIssueFieldMutation({
    issueId: issue.id,
    field: "priority",
    value: issue.priority,
    action: updateIssuePriority,
    errorMessage: "Failed to update issue priority",
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PillButton
          size={showLabel ? "xs" : "icon-xs"}
          disabled={isPending}
          aria-label={`Change priority from ${
            issuePriorityLabels[issue.priority]
          }`}
          className="self-start"
          onClick={(event) => event.stopPropagation()}
        >
          <PriorityIcon className={priorityIconStyles[issue.priority]} />
          {showLabel ? (
            <PillLabel>{issuePriorityLabels[issue.priority]}</PillLabel>
          ) : null}
        </PillButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-52 rounded-lg bg-popover before:hidden"
      >
        <IssueFieldOptions
          options={issuePriorityOptions}
          icons={priorityIcons}
          iconStyles={priorityIconStyles}
          value={issue.priority}
          disabled={isPending}
          onSelect={select}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function IssueTypeMenu({
  issue,
}: {
  issue: Pick<HomeIssue, "id" | "type">
}) {
  const TypeIcon = issueTypeIcons[issue.type]
  const { isPending, select } = useIssueFieldMutation({
    issueId: issue.id,
    field: "type",
    value: issue.type,
    action: updateIssueType,
    errorMessage: "Failed to update issue type",
    syncsDetail: true,
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PillButton
          disabled={isPending}
          aria-label={`Change type from ${issueTypeLabels[issue.type]}`}
          onClick={(event) => event.stopPropagation()}
        >
          <TypeIcon className={issueTypeIconStyles[issue.type]} />
          <PillLabel>{issueTypeLabels[issue.type]}</PillLabel>
        </PillButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-52 rounded-lg bg-popover before:hidden"
      >
        <IssueFieldOptions
          options={issueTypeOptions}
          icons={issueTypeIcons}
          iconStyles={issueTypeIconStyles}
          value={issue.type}
          disabled={isPending}
          onSelect={select}
        />
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
      cell: ({ row }) => <IssueTypeMenu issue={row.original} />,
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
      cell: ({ row }) =>
        row.original.projects?.repo ? (
          <RepoBadge repo={row.original.projects.repo} />
        ) : null,
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
          <IssueIndicatorBadge label="Blocked">
            <IconLock className={blockingIconStyles.blocked} />
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
          <IssueIndicatorBadge label="Blocking">
            <IconArrowBarToRight className={blockingIconStyles.blocking} />
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
