"use client"

import type { ReactNode } from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
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
  IconFilter,
  IconList,
  IconLock,
  IconLockOpen,
  IconPlus,
  IconSearch,
  IconTable,
  IconTagFilled,
  IconX,
} from "@tabler/icons-react"

import { fetchIssuesData } from "@/app/client-queries"
import type { HomeIssue, IssuesData } from "@/app/queries"
import type { AssignedIssueLabel } from "@/app/query-contracts"
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
import { ToggleGroup, ToggleGroupItem } from "@gentic/ui/toggle-group"
import { cn } from "@gentic/ui/utils"
import {
  issuePriorityLabels,
  issuePriorityOptions,
  issuePriorityOrder,
} from "@gentic/validators/issues"

import { BulkActionsToolbar } from "./bulk-actions-toolbar"
import { IssueLabelChips } from "./issue-label-chips"
import {
  AgentProviderBadge,
  blockingBadgeStyles,
  blockingIconStyles,
  getIssuesColumns,
  IssueIndicatorBadge,
  IssuePriorityMenu,
  IssueStatusMenu,
  IssueTypeMenu,
  PullRequestPills,
  RepoBadge,
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
type FilterSection =
  "status" | "priority" | "type" | "labels" | "blocking" | "project"

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
    ...issue.labels.map((label) => label.name),
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

/**
 * A multi-select filter backed by a `Set`. `onChange` runs on every mutation
 * that came from the user, so callers can centrally re-apply whatever a filter
 * change invalidates; `reset` skips it for bulk clears that do that once.
 *
 * The result is memoized on the selection so it can be depended on directly.
 */
function useSetFilter<T>(onChange: () => void) {
  const [values, setValues] = useState<Set<T>>(() => new Set())

  return useMemo(
    () => ({
      values,
      toggle(value: T) {
        setValues((current) => toggleInSet(current, value))
        onChange()
      },
      clear() {
        setValues(new Set())
        onChange()
      },
      reset() {
        setValues(new Set())
      },
    }),
    [values, onChange]
  )
}

function useSelectedRowIds(rowSelection: RowSelectionState) {
  return useMemo(
    () => Object.keys(rowSelection).filter((id) => rowSelection[id]),
    [rowSelection]
  )
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

function FilterMenuSection({
  label,
  badge,
  expanded,
  onToggle,
  children,
}: {
  label: string
  badge?: ReactNode
  expanded: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <>
      <DropdownMenuItem
        onSelect={(event) => event.preventDefault()}
        onClick={onToggle}
        className="justify-between gap-3"
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {badge}
        <IconChevronDown
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            expanded && "rotate-180"
          )}
        />
      </DropdownMenuItem>
      {expanded ? <div className="grid gap-0.5 pb-1">{children}</div> : null}
    </>
  )
}

function IssueRow({
  issue,
  isBlocked,
  isBlocking,
  isSelected,
  onSelectedChange,
  selectedLabelIds,
  onLabelSelect,
}: {
  issue: HomeIssue
  isBlocked: boolean
  isBlocking: boolean
  isSelected: boolean
  onSelectedChange: (selected: boolean) => void
  selectedLabelIds: Set<string>
  onLabelSelect: (labelId: string) => void
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
      <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_7rem] md:items-center md:gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 items-center gap-2">
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
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <IssueTypeMenu issue={issue} />
            <AgentProviderBadge provider={issue.agent_provider} />
            {isBlocked ? (
              <IssueIndicatorBadge label="Blocked">
                <IconLock className={blockingIconStyles.blocked} />
              </IssueIndicatorBadge>
            ) : null}
            {isBlocking ? (
              <IssueIndicatorBadge label="Blocking">
                <IconArrowBarToRight className={blockingIconStyles.blocking} />
              </IssueIndicatorBadge>
            ) : null}
            <PullRequestPills pullRequests={issue.pullRequests} />
            <IssuePriorityMenu issue={issue} showLabel />
            <IssueLabelChips
              labels={issue.labels}
              selectedLabelIds={selectedLabelIds}
              onLabelSelect={onLabelSelect}
            />
            {issue.projects?.repo ? (
              <RepoBadge repo={issue.projects.repo} />
            ) : null}
          </div>
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
  selectedLabelIds,
  onLabelSelect,
  labels,
}: {
  issues: HomeIssue[]
  blockedIssueIds: Set<string>
  blockingIssueIds: Set<string>
  filterKey: string
  rowSelection: RowSelectionState
  onRowSelectionChange: (selection: RowSelectionState) => void
  selectedLabelIds: Set<string>
  onLabelSelect: (labelId: string) => void
  labels: AssignedIssueLabel[]
}) {
  const columns = useMemo(
    () =>
      getIssuesColumns(
        blockedIssueIds,
        blockingIssueIds,
        selectedLabelIds,
        onLabelSelect
      ),
    [blockedIssueIds, blockingIssueIds, selectedLabelIds, onLabelSelect]
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
  const selectedIds = useSelectedRowIds(rowSelection)

  return (
    <div className="grid gap-4">
      {selectedIds.length > 0 ? (
        <BulkActionsToolbar
          selectedIds={selectedIds}
          labels={labels}
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
  // Narrowing the results reshuffles which issues land on which page, and a
  // selection the user can no longer see can't be acted on — so every filter
  // change rewinds to the first page and drops the selection.
  const onFilterChange = useCallback(() => {
    setPageIndex(0)
    setRowSelection({})
  }, [])
  const statusFilter = useSetFilter<HomeIssue["status"]>(onFilterChange)
  const typeFilter = useSetFilter<HomeIssue["type"]>(onFilterChange)
  const priorityFilter = useSetFilter<HomeIssue["priority"]>(onFilterChange)
  const projectFilter = useSetFilter<string>(onFilterChange)
  const [blockingFilter, setBlockingFilter] = useState<BlockingFilter>("all")
  const [labelFilter, setLabelFilter] = useState<Set<string>>(() => new Set())
  const [unlabeledFilter, setUnlabeledFilter] = useState(false)
  const activeLabelIds = useMemo(
    () => new Set(data.labels.map((label) => label.id)),
    [data.labels]
  )
  // When a label we're filtering by is archived in another tab, realtime
  // refetches the catalog without it. Ignore any such stale ids everywhere the
  // filter is read, so the label drops out of the list, count, and results
  // without touching unrelated filter state or the URL. `labelFilter` stays the
  // raw record of user intent; this is the effective, still-active view.
  const effectiveLabelFilter = useMemo(() => {
    if (labelFilter.size === 0) {
      return labelFilter
    }
    const active = new Set<string>()
    for (const id of labelFilter) {
      if (activeLabelIds.has(id)) {
        active.add(id)
      }
    }
    return active.size === labelFilter.size ? labelFilter : active
  }, [labelFilter, activeLabelIds])
  // Remember each active label's name so an archived label can still be named
  // in the notice below, even though realtime has already dropped it from the
  // catalog by the time we react.
  const labelNamesRef = useRef(new Map<string, string>())
  useEffect(() => {
    for (const label of data.labels) {
      labelNamesRef.current.set(label.id, label.name)
    }
  }, [data.labels])
  // Announce archive-driven filter removals exactly once. This effect only
  // fires the notice (an external side effect); the removal itself is derived
  // above, so no filter state is mutated here. Re-arm ids that become active
  // again so a later archival still notifies.
  const notifiedArchivedRef = useRef(new Set<string>())
  useEffect(() => {
    const notified = notifiedArchivedRef.current
    for (const id of notified) {
      if (activeLabelIds.has(id)) {
        notified.delete(id)
      }
    }
    const newlyArchived = Array.from(labelFilter).filter(
      (id) => !activeLabelIds.has(id) && !notified.has(id)
    )
    if (newlyArchived.length === 0) {
      return
    }
    for (const id of newlyArchived) {
      notified.add(id)
    }
    const names = newlyArchived.map(
      (id) => labelNamesRef.current.get(id) ?? "a label"
    )
    toast.info(
      names.length === 1
        ? `Removed archived label “${names[0]}” from your filter.`
        : `Removed ${names.length} archived labels from your filter.`
    )
  }, [labelFilter, activeLabelIds])
  const [expandedFilterSection, setExpandedFilterSection] =
    useState<FilterSection | null>(null)
  const activeFilterCount =
    statusFilter.values.size +
    priorityFilter.values.size +
    typeFilter.values.size +
    (blockingFilter !== "all" ? 1 : 0) +
    projectFilter.values.size +
    effectiveLabelFilter.size +
    (unlabeledFilter ? 1 : 0)
  const hasActiveFilters = globalFilter.length > 0 || activeFilterCount > 0
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
          (issue) =>
            statusFilter.values.size === 0 ||
            statusFilter.values.has(issue.status)
        )
        .filter(
          (issue) =>
            typeFilter.values.size === 0 || typeFilter.values.has(issue.type)
        )
        .filter(
          (issue) =>
            priorityFilter.values.size === 0 ||
            priorityFilter.values.has(issue.priority)
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
            projectFilter.values.size === 0 ||
            (issue.projects
              ? projectFilter.values.has(issue.projects.id)
              : false)
        )
        .filter((issue) => {
          if (unlabeledFilter) return issue.labels.length === 0
          const assignedIds = new Set(issue.labels.map((label) => label.id))
          return Array.from(effectiveLabelFilter).every((id) =>
            assignedIds.has(id)
          )
        })
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
      effectiveLabelFilter,
      unlabeledFilter,
    ]
  )
  const filterKey = [
    globalFilter,
    Array.from(statusFilter.values).sort().join(","),
    Array.from(typeFilter.values).sort().join(","),
    Array.from(priorityFilter.values).sort().join(","),
    blockingFilter,
    Array.from(projectFilter.values).sort().join(","),
    Array.from(effectiveLabelFilter).sort().join(","),
    unlabeledFilter ? "unlabeled" : "",
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
  const selectedIds = useSelectedRowIds(rowSelection)
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
    onFilterChange()
  }

  // Labels and "No labels" are mutually exclusive, so each clears the other.
  function toggleLabelFilter(labelId: string) {
    setLabelFilter((current) => toggleInSet(current, labelId))
    setUnlabeledFilter(false)
    onFilterChange()
  }

  const addLabelFilter = useCallback(
    (labelId: string) => {
      setLabelFilter((current) => new Set(current).add(labelId))
      setUnlabeledFilter(false)
      onFilterChange()
    },
    [onFilterChange]
  )

  function toggleUnlabeledFilter() {
    const next = !unlabeledFilter
    setUnlabeledFilter(next)
    if (next) setLabelFilter(new Set())
    onFilterChange()
  }

  function clearLabelFilter() {
    setLabelFilter(new Set())
    setUnlabeledFilter(false)
    onFilterChange()
  }

  function updateBlockingFilter(value: BlockingFilter) {
    setBlockingFilter(value)
    onFilterChange()
  }

  function toggleFilterSection(section: FilterSection) {
    setExpandedFilterSection((current) =>
      current === section ? null : section
    )
  }

  function clearFilters() {
    setGlobalFilter("")
    statusFilter.reset()
    typeFilter.reset()
    priorityFilter.reset()
    projectFilter.reset()
    setBlockingFilter("all")
    setLabelFilter(new Set())
    setUnlabeledFilter(false)
    onFilterChange()
  }

  function toggleStatus(status: HomeIssue["status"]) {
    setCollapsedStatuses((current) => toggleInSet(current, status))
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
        tables={["issues", "issue_relations", "issue_labels", "labels"]}
        queryKey={queryKeys.issues}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
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
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 max-w-sm flex-1">
                <IconSearch className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={globalFilter}
                  onChange={(event) => updateGlobalFilter(event.target.value)}
                  placeholder="Search issues…"
                  className="pl-9"
                />
              </div>
              <DropdownMenu
                onOpenChange={(open) => {
                  if (!open) {
                    setExpandedFilterSection(null)
                  }
                }}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    aria-label="Filters"
                    className="shrink-0"
                  >
                    <IconFilter className="size-3.5" />
                    {activeFilterCount > 0 ? (
                      <span className={activeFilterCountBadgeStyles}>
                        {activeFilterCount}
                      </span>
                    ) : null}
                    <IconChevronDown className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="w-64 rounded-lg bg-popover before:hidden"
                >
                  <FilterMenuSection
                    label="Status"
                    badge={
                      statusFilter.values.size > 0 ? (
                        <span className={activeFilterCountBadgeStyles}>
                          {statusFilter.values.size}
                        </span>
                      ) : null
                    }
                    expanded={expandedFilterSection === "status"}
                    onToggle={() => toggleFilterSection("status")}
                  >
                    {statusFilter.values.size > 0 ? (
                      <DropdownMenuItem onSelect={statusFilter.clear}>
                        Clear filter
                      </DropdownMenuItem>
                    ) : null}
                    {statusOptions.map((option) => {
                      const OptionIcon = statusIcons[option.value]

                      return (
                        <DropdownMenuCheckboxItem
                          key={option.value}
                          checked={statusFilter.values.has(option.value)}
                          onSelect={(event) => event.preventDefault()}
                          onCheckedChange={() =>
                            statusFilter.toggle(option.value)
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
                  </FilterMenuSection>
                  <DropdownMenuSeparator />
                  <FilterMenuSection
                    label="Labels"
                    badge={
                      effectiveLabelFilter.size > 0 || unlabeledFilter ? (
                        <span className={activeFilterCountBadgeStyles}>
                          {unlabeledFilter ? 1 : effectiveLabelFilter.size}
                        </span>
                      ) : null
                    }
                    expanded={expandedFilterSection === "labels"}
                    onToggle={() => toggleFilterSection("labels")}
                  >
                    {effectiveLabelFilter.size > 0 || unlabeledFilter ? (
                      <DropdownMenuItem onSelect={clearLabelFilter}>
                        Clear filter
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuCheckboxItem
                      checked={unlabeledFilter}
                      onSelect={(event) => event.preventDefault()}
                      onCheckedChange={toggleUnlabeledFilter}
                    >
                      No labels
                    </DropdownMenuCheckboxItem>
                    {data.labels.map((label) => (
                      <DropdownMenuCheckboxItem
                        key={label.id}
                        checked={effectiveLabelFilter.has(label.id)}
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={() => toggleLabelFilter(label.id)}
                        className="gap-2"
                      >
                        <IconTagFilled
                          className="size-3.5 shrink-0"
                          style={{ color: label.color }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {label.name}
                        </span>
                      </DropdownMenuCheckboxItem>
                    ))}
                  </FilterMenuSection>
                  <DropdownMenuSeparator />
                  <FilterMenuSection
                    label="Priority"
                    badge={
                      priorityFilter.values.size > 0 ? (
                        <span className={activeFilterCountBadgeStyles}>
                          {priorityFilter.values.size}
                        </span>
                      ) : null
                    }
                    expanded={expandedFilterSection === "priority"}
                    onToggle={() => toggleFilterSection("priority")}
                  >
                    {priorityFilter.values.size > 0 ? (
                      <DropdownMenuItem onSelect={priorityFilter.clear}>
                        Clear filter
                      </DropdownMenuItem>
                    ) : null}
                    {issuePriorityOptions.map((option) => {
                      const OptionIcon = priorityIcons[option.value]

                      return (
                        <DropdownMenuCheckboxItem
                          key={option.value}
                          checked={priorityFilter.values.has(option.value)}
                          onSelect={(event) => event.preventDefault()}
                          onCheckedChange={() =>
                            priorityFilter.toggle(option.value)
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
                  </FilterMenuSection>
                  <DropdownMenuSeparator />
                  <FilterMenuSection
                    label="Type"
                    badge={
                      typeFilter.values.size > 0 ? (
                        <span className={activeFilterCountBadgeStyles}>
                          {typeFilter.values.size}
                        </span>
                      ) : null
                    }
                    expanded={expandedFilterSection === "type"}
                    onToggle={() => toggleFilterSection("type")}
                  >
                    {typeFilter.values.size > 0 ? (
                      <DropdownMenuItem onSelect={typeFilter.clear}>
                        Clear filter
                      </DropdownMenuItem>
                    ) : null}
                    {issueTypeOptions.map((option) => {
                      const OptionIcon = issueTypeIcons[option.value]

                      return (
                        <DropdownMenuCheckboxItem
                          key={option.value}
                          checked={typeFilter.values.has(option.value)}
                          onSelect={(event) => event.preventDefault()}
                          onCheckedChange={() =>
                            typeFilter.toggle(option.value)
                          }
                          className="gap-3"
                        >
                          <OptionIcon className="size-4" />
                          <span className="min-w-0 flex-1 truncate">
                            {option.label}
                          </span>
                        </DropdownMenuCheckboxItem>
                      )
                    })}
                  </FilterMenuSection>
                  <DropdownMenuSeparator />
                  <FilterMenuSection
                    label="Blocking"
                    badge={
                      blockingFilter !== "all" ? (
                        <span
                          className={cn(
                            "ml-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium",
                            blockingFilterBadgeStyles[blockingFilter]
                          )}
                        >
                          {blockingFilterLabels[blockingFilter]}
                        </span>
                      ) : null
                    }
                    expanded={expandedFilterSection === "blocking"}
                    onToggle={() => toggleFilterSection("blocking")}
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
                  </FilterMenuSection>
                  <DropdownMenuSeparator />
                  <FilterMenuSection
                    label="Project"
                    badge={
                      projectFilter.values.size > 0 ? (
                        <span className={activeFilterCountBadgeStyles}>
                          {projectFilter.values.size}
                        </span>
                      ) : null
                    }
                    expanded={expandedFilterSection === "project"}
                    onToggle={() => toggleFilterSection("project")}
                  >
                    {projectFilter.values.size > 0 ? (
                      <DropdownMenuItem onSelect={projectFilter.clear}>
                        Clear filter
                      </DropdownMenuItem>
                    ) : null}
                    {availableProjects.length === 0 ? (
                      <DropdownMenuItem disabled>
                        No projects
                      </DropdownMenuItem>
                    ) : (
                      availableProjects.map((project) => (
                        <DropdownMenuCheckboxItem
                          key={project.id}
                          checked={projectFilter.values.has(project.id)}
                          onSelect={(event) => event.preventDefault()}
                          onCheckedChange={() =>
                            projectFilter.toggle(project.id)
                          }
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {project.name}
                          </span>
                        </DropdownMenuCheckboxItem>
                      ))
                    )}
                  </FilterMenuSection>
                </DropdownMenuContent>
              </DropdownMenu>
              {hasActiveFilters ? (
                <Button
                  variant="ghost"
                  onClick={clearFilters}
                  className="shrink-0"
                >
                  <IconX className="size-3.5" />
                  Clear filters
                </Button>
              ) : null}
              <ToggleGroup
                type="single"
                variant="outline"
                spacing={0}
                value={view}
                onValueChange={setView}
                className="ml-auto shrink-0"
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
                selectedLabelIds={effectiveLabelFilter}
                onLabelSelect={addLabelFilter}
                labels={data.labels}
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
                    labels={data.labels}
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
                                selectedLabelIds={effectiveLabelFilter}
                                onLabelSelect={addLabelFilter}
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
