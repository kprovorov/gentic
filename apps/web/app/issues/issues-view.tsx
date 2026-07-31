"use client"

import type { ReactNode } from "react"
import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import {
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table"
import {
  IconArrowBarToRight,
  IconChevronDown,
  IconList,
  IconLock,
  IconLockOpen,
  IconPlus,
  IconSearch,
  IconTable,
  IconX,
} from "@tabler/icons-react"

import { fetchIssuesData } from "@/app/client-queries"
import type { HomeIssue, IssuesData } from "@/app/queries"
import { queryKeys, queryStaleTimes } from "@/app/query-keys"
import { getIssueHref } from "@/app/issues/urls"
import { useNewIssueDialog } from "@/components/new-issue-dialog-provider"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { Button } from "@gentic/ui/button"
import { Checkbox } from "@gentic/ui/checkbox"
import { DataTable } from "@gentic/ui/data-table"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@gentic/ui/dropdown-menu"
import { Input } from "@gentic/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@gentic/ui/tooltip"
import { ToggleGroup, ToggleGroupItem } from "@gentic/ui/toggle-group"
import { cn } from "@gentic/ui/utils"
import {
  issuePriorityLabels,
  issuePriorityOptions,
  issuePriorityOrder,
} from "@gentic/validators/issues"

import { BulkActionsToolbar } from "./bulk-actions-toolbar"
import {
  blockingBadgeStyles,
  blockingIconStyles,
  formatDate,
  getIssuesColumns,
  IssuePriorityMenu,
  IssueStatusMenu,
  IssueTypeBadge,
  PullRequestPills,
  issueTypeIcons,
  issueTypeOptions,
  priorityIconStyles,
  priorityIcons,
  statusIconStyles,
  statusIcons,
  statusLabels,
  statusOptions,
  statusOrder,
} from "./issues-columns"

type IssuesViewMode = "list" | "table"
type BlockingFilter =
  "all" | "blocked" | "non-blocked" | "blocking" | "non-blocking"

const pageSize = 20

const blockingFilterLabels: Record<BlockingFilter, string> = {
  all: "All",
  blocked: "Blocked",
  "non-blocked": "Non-blocked",
  blocking: "Blocking",
  "non-blocking": "Non-blocking",
}

const blockingFilterOptions = [
  "all",
  "blocked",
  "non-blocked",
  "blocking",
  "non-blocking",
] as const
const activeFilterCountBadgeStyles =
  "ml-0.5 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground"

const blockingFilterBadgeStyles: Partial<Record<BlockingFilter, string>> = {
  blocked: blockingBadgeStyles.blocked,
  "non-blocked": "bg-muted text-muted-foreground",
  blocking: blockingBadgeStyles.blocking,
  "non-blocking": "bg-muted text-muted-foreground",
}

const blockingFilterIconStyles: Partial<Record<BlockingFilter, string>> = {
  blocked: "text-red-700 dark:text-red-300",
  "non-blocked": "text-emerald-700 dark:text-emerald-300",
  blocking: "text-amber-700 dark:text-amber-300",
}

function matchesBlockingFilter(
  issue: HomeIssue,
  filter: BlockingFilter,
  blockedIssueIds: Set<string>,
  blockingIssueIds: Set<string>
) {
  const isBlocked = blockedIssueIds.has(issue.id)
  const isBlocking = blockingIssueIds.has(issue.id)

  switch (filter) {
    case "blocked":
      return isBlocked
    case "non-blocked":
      return !isBlocked
    case "blocking":
      return isBlocking
    case "non-blocking":
      return !isBlocked && !isBlocking
    case "all":
      return true
  }
}

function matchesIssue(issue: HomeIssue, filterValue: string) {
  const haystack = [
    issue.code,
    issue.title,
    issue.projects?.name,
    issue.projects?.repo,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  return haystack.includes(filterValue.toLowerCase())
}

function toggleInSet<T>(set: Set<T>, value: T) {
  const next = new Set(set)

  if (next.has(value)) {
    next.delete(value)
  } else {
    next.add(value)
  }

  return next
}

function compareIssues(issueA: HomeIssue, issueB: HomeIssue) {
  const statusDelta = statusOrder[issueA.status] - statusOrder[issueB.status]

  if (statusDelta !== 0) {
    return statusDelta
  }

  const priorityDelta =
    issuePriorityOrder[issueB.priority] - issuePriorityOrder[issueA.priority]

  if (priorityDelta !== 0) {
    return priorityDelta
  }

  return (
    new Date(issueB.created_at).getTime() -
    new Date(issueA.created_at).getTime()
  )
}

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

function IssueRow({
  issue,
  isBlocked,
  isBlocking,
  isSelected,
  onSelectedChange,
}: {
  issue: HomeIssue
  isBlocked: boolean
  isBlocking: boolean
  isSelected: boolean
  onSelectedChange: (selected: boolean) => void
}) {
  const issueHref = getIssueHref(issue) ?? "/issues"

  return (
    <div
      className={cn(
        "flex gap-3 px-4 py-3 transition-colors hover:bg-muted/45",
        isSelected && "bg-primary/5"
      )}
    >
      <Checkbox
        checked={isSelected}
        onCheckedChange={(value) => onSelectedChange(value === true)}
        onClick={(event) => event.stopPropagation()}
        aria-label={`Select ${issue.code ?? issue.title ?? "issue"}`}
        className="mt-1"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-2 md:grid md:grid-cols-[minmax(0,1fr)_minmax(8rem,11rem)_minmax(10rem,14rem)_7rem] md:items-center md:gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2 md:contents">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <IssueStatusMenu issue={issue} />
            <Link
              href={issueHref}
              className="inline-flex min-w-0 items-baseline gap-2 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              {issue.code ? (
                <span className="shrink-0 font-mono text-xs font-semibold text-muted-foreground">
                  {issue.code}
                </span>
              ) : null}
              <span
                className={cn(
                  "truncate font-medium",
                  !issue.title && "text-muted-foreground italic"
                )}
              >
                {issue.title ?? "Generating title..."}
              </span>
            </Link>
            <IssueTypeBadge type={issue.type} />
            {isBlocked ? (
              <IssueIndicatorBadge
                label="Blocked"
                className={blockingBadgeStyles.blocked}
              >
                <IconLock
                  className={cn("size-3.5", blockingIconStyles.blocked)}
                />
              </IssueIndicatorBadge>
            ) : null}
            {isBlocking ? (
              <IssueIndicatorBadge
                label="Blocking"
                className={blockingBadgeStyles.blocking}
              >
                <IconArrowBarToRight
                  className={cn("size-3.5", blockingIconStyles.blocking)}
                />
              </IssueIndicatorBadge>
            ) : null}
            <PullRequestPills pullRequests={issue.pullRequests} />
          </div>
          <IssuePriorityMenu issue={issue} showLabel />
        </div>
        <div className="min-w-0 text-sm text-muted-foreground">
          <span className="block truncate">
            {issue.projects?.name ?? "Unknown project"}
          </span>
          {issue.projects?.repo ? (
            <span className="block truncate text-xs">
              {issue.projects.repo}
            </span>
          ) : null}
        </div>
        <div className="text-sm text-muted-foreground md:text-right">
          {formatDate(issue.created_at)}
        </div>
      </div>
    </div>
  )
}

function IssuesTableView({
  issues,
  blockedIssueIds,
  blockingIssueIds,
  filterKey,
  rowSelection,
  onRowSelectionChange,
}: {
  issues: HomeIssue[]
  blockedIssueIds: Set<string>
  blockingIssueIds: Set<string>
  filterKey: string
  rowSelection: RowSelectionState
  onRowSelectionChange: (selection: RowSelectionState) => void
}) {
  const columns = useMemo(
    () => getIssuesColumns(blockedIssueIds, blockingIssueIds),
    [blockedIssueIds, blockingIssueIds]
  )
  const [sorting, setSorting] = useState<SortingState>([
    { id: "status", desc: false },
    { id: "priority", desc: true },
    { id: "created_at", desc: true },
  ])
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize,
  })

  useEffect(() => {
    setPagination((current) => ({ ...current, pageIndex: 0 }))
  }, [filterKey])

  useEffect(() => {
    onRowSelectionChange({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.pageIndex])

  const table = useReactTable({
    data: issues,
    columns,
    state: { sorting, pagination, rowSelection },
    getRowId: (issue) => issue.id,
    enableRowSelection: true,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    onRowSelectionChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(rowSelection) : updater
      onRowSelectionChange(next)
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })
  const selectedIds = useMemo(
    () => Object.keys(rowSelection).filter((id) => rowSelection[id]),
    [rowSelection]
  )

  return (
    <div className="grid gap-4">
      {selectedIds.length > 0 ? (
        <BulkActionsToolbar
          selectedIds={selectedIds}
          onDone={() => onRowSelectionChange({})}
        />
      ) : null}
      <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
        <DataTable table={table} columns={columns} />
      </div>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {issues.length} issue{issues.length === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}

export function IssuesView({ initialData }: { initialData: IssuesData }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { openDialog: openNewIssueDialog } = useNewIssueDialog()
  const view: IssuesViewMode =
    searchParams.get("view") === "table" ? "table" : "list"
  const { data } = useQuery({
    queryKey: queryKeys.issues,
    queryFn: fetchIssuesData,
    initialData,
    staleTime: queryStaleTimes.realtime,
  })
  const blockedIssueIds = useMemo(
    () => new Set(data.blockedIssueIds),
    [data.blockedIssueIds]
  )
  const blockingIssueIds = useMemo(
    () => new Set(data.blockingIssueIds),
    [data.blockingIssueIds]
  )
  const [globalFilter, setGlobalFilter] = useState("")
  const [pageIndex, setPageIndex] = useState(0)
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [collapsedStatuses, setCollapsedStatuses] = useState<
    Set<HomeIssue["status"]>
  >(() => new Set())
  const [statusFilter, setStatusFilter] = useState<Set<HomeIssue["status"]>>(
    () => new Set()
  )
  const [typeFilter, setTypeFilter] = useState<Set<HomeIssue["type"]>>(
    () => new Set()
  )
  const [priorityFilter, setPriorityFilter] = useState<
    Set<HomeIssue["priority"]>
  >(() => new Set())
  const [blockingFilter, setBlockingFilter] = useState<BlockingFilter>("all")
  const [projectFilter, setProjectFilter] = useState<Set<string>>(
    () => new Set()
  )
  const hasActiveFilters =
    globalFilter.length > 0 ||
    statusFilter.size > 0 ||
    typeFilter.size > 0 ||
    priorityFilter.size > 0 ||
    blockingFilter !== "all" ||
    projectFilter.size > 0
  const availableProjects = useMemo(() => {
    const projects = new Map<string, { id: string; name: string }>()

    for (const issue of data.issues) {
      if (issue.projects && !projects.has(issue.projects.id)) {
        projects.set(issue.projects.id, {
          id: issue.projects.id,
          name: issue.projects.name,
        })
      }
    }

    return Array.from(projects.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    )
  }, [data.issues])
  const filteredIssues = useMemo(
    () =>
      data.issues
        .filter((issue) => matchesIssue(issue, globalFilter))
        .filter(
          (issue) => statusFilter.size === 0 || statusFilter.has(issue.status)
        )
        .filter((issue) => typeFilter.size === 0 || typeFilter.has(issue.type))
        .filter(
          (issue) =>
            priorityFilter.size === 0 || priorityFilter.has(issue.priority)
        )
        .filter((issue) =>
          matchesBlockingFilter(
            issue,
            blockingFilter,
            blockedIssueIds,
            blockingIssueIds
          )
        )
        .filter(
          (issue) =>
            projectFilter.size === 0 ||
            (issue.projects ? projectFilter.has(issue.projects.id) : false)
        )
        .toSorted(compareIssues),
    [
      data.issues,
      globalFilter,
      statusFilter,
      typeFilter,
      priorityFilter,
      blockingFilter,
      blockedIssueIds,
      blockingIssueIds,
      projectFilter,
    ]
  )
  const filterKey = [
    globalFilter,
    Array.from(statusFilter).sort().join(","),
    Array.from(typeFilter).sort().join(","),
    Array.from(priorityFilter).sort().join(","),
    blockingFilter,
    Array.from(projectFilter).sort().join(","),
  ].join("|")
  const pageCount = Math.max(1, Math.ceil(filteredIssues.length / pageSize))
  const safePageIndex = Math.min(pageIndex, pageCount - 1)
  const pagedIssues = filteredIssues.slice(
    safePageIndex * pageSize,
    safePageIndex * pageSize + pageSize
  )
  const statusCounts = useMemo(() => {
    const counts = new Map<HomeIssue["status"], number>()

    for (const issue of filteredIssues) {
      counts.set(issue.status, (counts.get(issue.status) ?? 0) + 1)
    }

    return counts
  }, [filteredIssues])
  const groupedIssues = useMemo(() => {
    const groups = new Map<HomeIssue["status"], HomeIssue[]>()

    for (const issue of pagedIssues) {
      const group = groups.get(issue.status)

      if (group) {
        group.push(issue)
      } else {
        groups.set(issue.status, [issue])
      }
    }

    return Array.from(groups.entries()).sort(
      ([statusA], [statusB]) => statusOrder[statusA] - statusOrder[statusB]
    )
  }, [pagedIssues])
  const selectedIds = useMemo(
    () => Object.keys(rowSelection).filter((id) => rowSelection[id]),
    [rowSelection]
  )
  const pagedIssueIds = useMemo(
    () => pagedIssues.map((issue) => issue.id),
    [pagedIssues]
  )
  const selectedPagedIssueCount = pagedIssueIds.filter(
    (id) => rowSelection[id]
  ).length
  const allPagedIssuesSelected =
    pagedIssueIds.length > 0 && selectedPagedIssueCount === pagedIssueIds.length
  const pageSelectionChecked = allPagedIssuesSelected
    ? true
    : selectedPagedIssueCount > 0
      ? "indeterminate"
      : false

  function updateGlobalFilter(value: string) {
    setGlobalFilter(value)
    setPageIndex(0)
    setRowSelection({})
  }

  function toggleStatusFilter(status: HomeIssue["status"]) {
    setStatusFilter((current) => toggleInSet(current, status))
    setPageIndex(0)
    setRowSelection({})
  }

  function toggleTypeFilter(type: HomeIssue["type"]) {
    setTypeFilter((current) => toggleInSet(current, type))
    setPageIndex(0)
    setRowSelection({})
  }

  function togglePriorityFilter(priority: HomeIssue["priority"]) {
    setPriorityFilter((current) => toggleInSet(current, priority))
    setPageIndex(0)
    setRowSelection({})
  }

  function toggleProjectFilter(projectId: string) {
    setProjectFilter((current) => toggleInSet(current, projectId))
    setPageIndex(0)
    setRowSelection({})
  }

  function updateBlockingFilter(value: BlockingFilter) {
    setBlockingFilter(value)
    setPageIndex(0)
    setRowSelection({})
  }

  function clearStatusFilter() {
    setStatusFilter(new Set())
    setPageIndex(0)
    setRowSelection({})
  }

  function clearTypeFilter() {
    setTypeFilter(new Set())
    setPageIndex(0)
    setRowSelection({})
  }

  function clearPriorityFilter() {
    setPriorityFilter(new Set())
    setPageIndex(0)
    setRowSelection({})
  }

  function clearProjectFilter() {
    setProjectFilter(new Set())
    setPageIndex(0)
    setRowSelection({})
  }

  function clearFilters() {
    setGlobalFilter("")
    setStatusFilter(new Set())
    setTypeFilter(new Set())
    setPriorityFilter(new Set())
    setBlockingFilter("all")
    setProjectFilter(new Set())
    setPageIndex(0)
    setRowSelection({})
  }

  function toggleStatus(status: HomeIssue["status"]) {
    setCollapsedStatuses((current) => {
      const next = new Set(current)

      if (next.has(status)) {
        next.delete(status)
      } else {
        next.add(status)
      }

      return next
    })
  }

  function toggleIssueSelected(issueId: string, selected: boolean) {
    setRowSelection((current) => {
      const next = { ...current }

      if (selected) {
        next[issueId] = true
      } else {
        delete next[issueId]
      }

      return next
    })
  }

  function togglePagedIssuesSelected(selected: boolean) {
    setRowSelection((current) => {
      const next = { ...current }

      for (const id of pagedIssueIds) {
        if (selected) {
          next[id] = true
        } else {
          delete next[id]
        }
      }

      return next
    })
  }

  function setView(nextView: string) {
    if (!nextView || nextView === view) {
      return
    }

    const params = new URLSearchParams(searchParams.toString())

    if (nextView === "list") {
      params.delete("view")
    } else {
      params.set("view", nextView)
    }

    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    })
  }

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
          <Button onClick={openNewIssueDialog}>
            <IconPlus />
            New issue
          </Button>
        </header>

        {data.issues.length === 0 ? (
          <section className="flex min-h-72 flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-8 text-center">
            <div className="grid gap-1">
              <h2 className="text-xl">No issues yet</h2>
              <p className="max-w-md text-sm text-muted-foreground">
                Create an issue and attach it to one of your projects.
              </p>
            </div>
            <Button variant="outline" onClick={openNewIssueDialog}>
              <IconPlus />
              Create issue
            </Button>
          </section>
        ) : (
          <section className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative max-w-sm flex-1">
                  <IconSearch className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={globalFilter}
                    onChange={(event) => updateGlobalFilter(event.target.value)}
                    placeholder="Search issues…"
                    className="pl-9"
                  />
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      Status
                      {statusFilter.size > 0 ? (
                        <span className={activeFilterCountBadgeStyles}>
                          {statusFilter.size}
                        </span>
                      ) : null}
                      <IconChevronDown className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="w-60 rounded-lg bg-popover before:hidden"
                  >
                    {statusFilter.size > 0 ? (
                      <>
                        <DropdownMenuItem onSelect={clearStatusFilter}>
                          Clear filter
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    ) : null}
                    {statusOptions.map((option) => {
                      const OptionIcon = statusIcons[option.value]

                      return (
                        <DropdownMenuCheckboxItem
                          key={option.value}
                          checked={statusFilter.has(option.value)}
                          onSelect={(event) => event.preventDefault()}
                          onCheckedChange={() =>
                            toggleStatusFilter(option.value)
                          }
                          className="gap-3"
                        >
                          <OptionIcon
                            className={cn(
                              "size-4",
                              statusIconStyles[option.value]
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {option.label}
                          </span>
                        </DropdownMenuCheckboxItem>
                      )
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={
                        priorityFilter.size > 0
                          ? `Priority (${priorityFilter.size})`
                          : "Priority"
                      }
                    >
                      Priority
                      {priorityFilter.size > 0 ? (
                        <span className={activeFilterCountBadgeStyles}>
                          {priorityFilter.size}
                        </span>
                      ) : null}
                      <IconChevronDown className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="w-52 rounded-lg bg-popover before:hidden"
                  >
                    {priorityFilter.size > 0 ? (
                      <>
                        <DropdownMenuItem onSelect={clearPriorityFilter}>
                          Clear filter
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    ) : null}
                    {issuePriorityOptions.map((option) => {
                      const OptionIcon = priorityIcons[option.value]

                      return (
                        <DropdownMenuCheckboxItem
                          key={option.value}
                          checked={priorityFilter.has(option.value)}
                          onSelect={(event) => event.preventDefault()}
                          onCheckedChange={() =>
                            togglePriorityFilter(option.value)
                          }
                          className="gap-3"
                        >
                          <OptionIcon
                            className={cn(
                              "size-4",
                              priorityIconStyles[option.value]
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {issuePriorityLabels[option.value]}
                          </span>
                        </DropdownMenuCheckboxItem>
                      )
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      Type
                      {typeFilter.size > 0 ? (
                        <span className={activeFilterCountBadgeStyles}>
                          {typeFilter.size}
                        </span>
                      ) : null}
                      <IconChevronDown className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="w-60 rounded-lg bg-popover before:hidden"
                  >
                    {typeFilter.size > 0 ? (
                      <>
                        <DropdownMenuItem onSelect={clearTypeFilter}>
                          Clear filter
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    ) : null}
                    {issueTypeOptions.map((option) => {
                      const OptionIcon = issueTypeIcons[option.value]

                      return (
                        <DropdownMenuCheckboxItem
                          key={option.value}
                          checked={typeFilter.has(option.value)}
                          onSelect={(event) => event.preventDefault()}
                          onCheckedChange={() => toggleTypeFilter(option.value)}
                          className="gap-3"
                        >
                          <OptionIcon className="size-4" />
                          <span className="min-w-0 flex-1 truncate">
                            {option.label}
                          </span>
                        </DropdownMenuCheckboxItem>
                      )
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      Blocking
                      {blockingFilter !== "all" ? (
                        <span
                          className={cn(
                            "ml-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium",
                            blockingFilterBadgeStyles[blockingFilter]
                          )}
                        >
                          {blockingFilterLabels[blockingFilter]}
                        </span>
                      ) : null}
                      <IconChevronDown className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="w-60 rounded-lg bg-popover before:hidden"
                  >
                    {blockingFilterOptions.map((option) => {
                      const OptionIcon =
                        option === "all"
                          ? IconList
                          : option === "blocked"
                            ? IconLock
                            : option === "non-blocked"
                              ? IconLockOpen
                              : option === "non-blocking"
                                ? IconX
                                : IconArrowBarToRight

                      return (
                        <DropdownMenuCheckboxItem
                          key={option}
                          checked={blockingFilter === option}
                          onSelect={(event) => event.preventDefault()}
                          onCheckedChange={() => updateBlockingFilter(option)}
                          className="gap-3"
                        >
                          <OptionIcon
                            className={cn(
                              "size-4",
                              blockingFilterIconStyles[option] ??
                                "text-muted-foreground"
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {blockingFilterLabels[option]}
                          </span>
                        </DropdownMenuCheckboxItem>
                      )
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      Project
                      {projectFilter.size > 0 ? (
                        <span className={activeFilterCountBadgeStyles}>
                          {projectFilter.size}
                        </span>
                      ) : null}
                      <IconChevronDown className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="w-60 rounded-lg bg-popover before:hidden"
                  >
                    {projectFilter.size > 0 ? (
                      <>
                        <DropdownMenuItem onSelect={clearProjectFilter}>
                          Clear filter
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    ) : null}
                    {availableProjects.length === 0 ? (
                      <DropdownMenuItem disabled>No projects</DropdownMenuItem>
                    ) : (
                      availableProjects.map((project) => (
                        <DropdownMenuCheckboxItem
                          key={project.id}
                          checked={projectFilter.has(project.id)}
                          onSelect={(event) => event.preventDefault()}
                          onCheckedChange={() =>
                            toggleProjectFilter(project.id)
                          }
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {project.name}
                          </span>
                        </DropdownMenuCheckboxItem>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                {hasActiveFilters ? (
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    <IconX className="size-3.5" />
                    Clear filters
                  </Button>
                ) : null}
              </div>
              <ToggleGroup
                type="single"
                variant="outline"
                value={view}
                onValueChange={setView}
              >
                <ToggleGroupItem value="list" aria-label="List view">
                  <IconList />
                </ToggleGroupItem>
                <ToggleGroupItem value="table" aria-label="Table view">
                  <IconTable />
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            {view === "table" ? (
              <IssuesTableView
                issues={filteredIssues}
                blockedIssueIds={blockedIssueIds}
                blockingIssueIds={blockingIssueIds}
                filterKey={filterKey}
                rowSelection={rowSelection}
                onRowSelectionChange={setRowSelection}
              />
            ) : pagedIssues.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No results.
              </div>
            ) : (
              <div className="grid gap-4">
                {selectedIds.length > 0 ? (
                  <BulkActionsToolbar
                    selectedIds={selectedIds}
                    onDone={() => setRowSelection({})}
                  />
                ) : null}
                <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
                  <div className="flex items-center gap-3 border-b bg-muted/35 px-4 py-3">
                    <Checkbox
                      checked={pageSelectionChecked}
                      onCheckedChange={(value) =>
                        togglePagedIssuesSelected(value === true)
                      }
                      aria-label="Select all visible issues"
                    />
                    <span className="text-sm font-medium text-muted-foreground">
                      Select visible issues
                    </span>
                  </div>
                  {groupedIssues.map(([status, issues]) => {
                    const StatusIcon = statusIcons[status]
                    const isCollapsed = collapsedStatuses.has(status)
                    const groupContentId = `issues-group-${status}`

                    return (
                      <section
                        key={status}
                        className="border-b last:border-b-0"
                      >
                        <button
                          type="button"
                          className="group flex w-full items-center gap-3 bg-muted/55 px-4 py-3 text-left transition-all duration-150 hover:bg-muted hover:shadow-[inset_3px_0_0_var(--primary)] focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
                          aria-expanded={!isCollapsed}
                          aria-controls={groupContentId}
                          onClick={() => toggleStatus(status)}
                        >
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 group-hover:bg-background/80 group-hover:text-foreground">
                            <IconChevronDown
                              className={cn(
                                "size-4 transition-transform duration-200 ease-out",
                                isCollapsed && "-rotate-90"
                              )}
                            />
                          </span>
                          <StatusIcon
                            className={cn(
                              "size-4 shrink-0 transition-colors duration-150 group-hover:text-foreground",
                              statusIconStyles[status]
                            )}
                          />
                          <span
                            className={cn(
                              "text-sm font-semibold transition-colors duration-150 group-hover:text-foreground",
                              statusIconStyles[status]
                            )}
                          >
                            {statusLabels[status]}
                          </span>
                          <span className="rounded-full bg-background/70 px-2 py-0.5 text-xs font-medium text-muted-foreground transition-colors duration-150 group-hover:text-foreground">
                            {statusCounts.get(status) ?? issues.length}
                          </span>
                        </button>
                        <div
                          id={groupContentId}
                          className={cn(
                            "grid overflow-hidden transition-[grid-template-rows,opacity] duration-200 ease-out",
                            isCollapsed
                              ? "grid-rows-[0fr] opacity-0"
                              : "grid-rows-[1fr] opacity-100"
                          )}
                          aria-hidden={isCollapsed}
                          inert={isCollapsed ? true : undefined}
                        >
                          <div className="min-h-0 divide-y overflow-hidden">
                            {issues.map((issue) => (
                              <IssueRow
                                key={issue.id}
                                issue={issue}
                                isBlocked={blockedIssueIds.has(issue.id)}
                                isBlocking={blockingIssueIds.has(issue.id)}
                                isSelected={rowSelection[issue.id] === true}
                                onSelectedChange={(selected) =>
                                  toggleIssueSelected(issue.id, selected)
                                }
                              />
                            ))}
                          </div>
                        </div>
                      </section>
                    )
                  })}
                </div>
              </div>
            )}
            {view === "list" ? (
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  {filteredIssues.length} issue
                  {filteredIssues.length === 1 ? "" : "s"}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setPageIndex(Math.max(0, safePageIndex - 1))
                      setRowSelection({})
                    }}
                    disabled={safePageIndex === 0}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setPageIndex(Math.min(pageCount - 1, safePageIndex + 1))
                      setRowSelection({})
                    }}
                    disabled={safePageIndex >= pageCount - 1}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </section>
        )}
      </div>
    </div>
  )
}
