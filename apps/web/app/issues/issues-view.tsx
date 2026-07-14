"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  IconCheck,
  IconChevronDown,
  IconLock,
  IconPlus,
  IconSearch,
} from "@tabler/icons-react"

import { getIssuesData, type HomeIssue, type IssuesData } from "@/app/queries"
import { queryKeys } from "@/app/query-keys"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { Button } from "@gentic/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@gentic/ui/dropdown-menu"
import { Input } from "@gentic/ui/input"
import { cn } from "@gentic/ui/utils"

import { updateIssueStatus } from "./actions"
import {
  formatDate,
  issueTypeIcons,
  issueTypeLabels,
  issueTypeStyles,
  statusIconStyles,
  statusIcons,
  statusLabels,
  statusOptions,
  statusOrder,
} from "./issues-columns"

const pageSize = 20

function matchesIssue(issue: HomeIssue, filterValue: string) {
  const haystack = [issue.title, issue.projects?.name, issue.projects?.repo]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  return haystack.includes(filterValue.toLowerCase())
}

function compareIssues(issueA: HomeIssue, issueB: HomeIssue) {
  const statusDelta = statusOrder[issueA.status] - statusOrder[issueB.status]

  if (statusDelta !== 0) {
    return statusDelta
  }

  return (
    new Date(issueB.created_at).getTime() - new Date(issueA.created_at).getTime()
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
          className={cn(
            "min-w-0 truncate font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            !issue.title && "text-muted-foreground italic"
          )}
        >
          {issue.title ?? "Generating title..."}
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

function IssueStatusMenu({ issue }: { issue: HomeIssue }) {
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
                  ? { ...currentIssue, status: nextStatus as HomeIssue["status"] }
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
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-muted"
        >
          <StatusIcon className={cn("size-4", statusIconStyles[issue.status])} />
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

export function IssuesView({ initialData }: { initialData: IssuesData }) {
  const { data } = useQuery({
    queryKey: queryKeys.issues,
    queryFn: getIssuesData,
    initialData,
  })
  const blockedIssueIds = useMemo(
    () => new Set(data.blockedIssueIds),
    [data.blockedIssueIds]
  )
  const [globalFilter, setGlobalFilter] = useState("")
  const [pageIndex, setPageIndex] = useState(0)
  const [collapsedStatuses, setCollapsedStatuses] = useState<
    Set<HomeIssue["status"]>
  >(() => new Set())
  const filteredIssues = useMemo(
    () =>
      data.issues
        .filter((issue) => matchesIssue(issue, globalFilter))
        .toSorted(compareIssues),
    [data.issues, globalFilter]
  )
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
            <div className="relative max-w-sm">
              <IconSearch className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={globalFilter}
                onChange={(event) => updateGlobalFilter(event.target.value)}
                placeholder="Search issues…"
                className="pl-9"
              />
            </div>
            {pagedIssues.length === 0 ? (
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
          </section>
        )}
      </div>
    </div>
  )
}
