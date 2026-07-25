"use client"

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
  IconChevronDown,
  IconList,
  IconLock,
  IconPlus,
  IconSearch,
  IconTable,
} from "@tabler/icons-react"

import { fetchIssuesData } from "@/app/client-queries"
import type { HomeIssue, IssuesData } from "@/app/queries"
import { queryKeys, queryStaleTimes } from "@/app/query-keys"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { Button } from "@gentic/ui/button"
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

import { BulkActionsToolbar } from "./bulk-actions-toolbar"
import {
  formatDate,
  getIssuesColumns,
  IssueStatusMenu,
  issueTypeIcons,
  issueTypeLabels,
  issueTypeOptions,
  issueTypeStyles,
  statusIconStyles,
  statusIcons,
  statusLabels,
  statusOptions,
  statusOrder,
} from "./issues-columns"

type IssuesViewMode = "list" | "table"

const pageSize = 20

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

  return (
    new Date(issueB.created_at).getTime() -
    new Date(issueA.created_at).getTime()
  )
}

function IssueRow({
  issue,
  isBlocked,
}: {
  issue: HomeIssue
  isBlocked: boolean
}) {
  const TypeIcon = issueTypeIcons[issue.type]

  return (
    <div className="grid gap-3 px-4 py-3 transition-colors hover:bg-muted/45 md:grid-cols-[minmax(0,1fr)_minmax(10rem,14rem)_7rem]">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <IssueStatusMenu issue={issue} />
        <Link
          href={`/issues/${issue.id}`}
          className="inline-flex min-w-0 items-baseline gap-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
      <div className="min-w-0 text-sm text-muted-foreground">
        <span className="block truncate">
          {issue.projects?.name ?? "Unknown project"}
        </span>
        {issue.projects?.repo ? (
          <span className="block truncate text-xs">{issue.projects.repo}</span>
        ) : null}
      </div>
      <div className="text-sm text-muted-foreground md:text-right">
        {formatDate(issue.created_at)}
      </div>
    </div>
  )
}

function IssuesTableView({
  issues,
  blockedIssueIds,
  filterKey,
  rowSelection,
  onRowSelectionChange,
}: {
  issues: HomeIssue[]
  blockedIssueIds: Set<string>
  filterKey: string
  rowSelection: RowSelectionState
  onRowSelectionChange: (selection: RowSelectionState) => void
}) {
  const columns = useMemo(
    () => getIssuesColumns(blockedIssueIds),
    [blockedIssueIds]
  )
  const [sorting, setSorting] = useState<SortingState>([
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
  const [projectFilter, setProjectFilter] = useState<Set<string>>(
    () => new Set()
  )
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
            projectFilter.size === 0 ||
            (issue.projects ? projectFilter.has(issue.projects.id) : false)
        )
        .toSorted(compareIssues),
    [data.issues, globalFilter, statusFilter, typeFilter, projectFilter]
  )
  const filterKey = [
    globalFilter,
    Array.from(statusFilter).sort().join(","),
    Array.from(typeFilter).sort().join(","),
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

  function updateGlobalFilter(value: string) {
    setGlobalFilter(value)
    setPageIndex(0)
  }

  function toggleStatusFilter(status: HomeIssue["status"]) {
    setStatusFilter((current) => toggleInSet(current, status))
    setPageIndex(0)
  }

  function toggleTypeFilter(type: HomeIssue["type"]) {
    setTypeFilter((current) => toggleInSet(current, type))
    setPageIndex(0)
  }

  function toggleProjectFilter(projectId: string) {
    setProjectFilter((current) => toggleInSet(current, projectId))
    setPageIndex(0)
  }

  function clearStatusFilter() {
    setStatusFilter(new Set())
    setPageIndex(0)
  }

  function clearTypeFilter() {
    setTypeFilter(new Set())
    setPageIndex(0)
  }

  function clearProjectFilter() {
    setProjectFilter(new Set())
    setPageIndex(0)
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
          <Button asChild>
            <Link href="/issues/new">
              <IconPlus />
              New issue
            </Link>
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
            <Button asChild variant="outline">
              <Link href="/issues/new">
                <IconPlus />
                Create issue
              </Link>
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
                        <span className="ml-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-xs font-medium text-primary">
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
                    <Button variant="outline" size="sm">
                      Type
                      {typeFilter.size > 0 ? (
                        <span className="ml-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-xs font-medium text-primary">
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
                      Project
                      {projectFilter.size > 0 ? (
                        <span className="ml-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-xs font-medium text-primary">
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
                filterKey={filterKey}
                rowSelection={rowSelection}
                onRowSelectionChange={setRowSelection}
              />
            ) : pagedIssues.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No results.
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
                {groupedIssues.map(([status, issues]) => {
                  const StatusIcon = statusIcons[status]
                  const isCollapsed = collapsedStatuses.has(status)
                  const groupContentId = `issues-group-${status}`

                  return (
                    <section key={status} className="border-b last:border-b-0">
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
                            />
                          ))}
                        </div>
                      </div>
                    </section>
                  )
                })}
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
                    onClick={() => setPageIndex(Math.max(0, safePageIndex - 1))}
                    disabled={safePageIndex === 0}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setPageIndex(Math.min(pageCount - 1, safePageIndex + 1))
                    }
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
