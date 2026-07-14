"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  IconChevronDown,
  IconLock,
  IconPlus,
  IconSearch,
} from "@tabler/icons-react"

import { getIssuesData, type HomeIssue, type IssuesData } from "@/app/queries"
import { queryKeys } from "@/app/query-keys"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { Button } from "@gentic/ui/button"
import { Input } from "@gentic/ui/input"
import { cn } from "@gentic/ui/utils"

import {
  formatDate,
  issueTypeIcons,
  issueTypeLabels,
  issueTypeStyles,
  statusIcons,
  statusLabels,
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
    <Link
      href={`/issues/${issue.id}`}
      className="grid gap-3 px-4 py-3 transition-colors hover:bg-muted/45 md:grid-cols-[minmax(0,1fr)_minmax(10rem,14rem)_7rem]"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span
          className={cn(
            "min-w-0 truncate font-medium hover:text-primary",
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
    </Link>
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
                        className="flex w-full items-center gap-3 bg-muted/55 px-4 py-3 text-left transition-colors hover:bg-muted/75 focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
                        aria-expanded={!isCollapsed}
                        aria-controls={groupContentId}
                        onClick={() => toggleStatus(status)}
                      >
                        <IconChevronDown
                          className={cn(
                            "size-4 shrink-0 text-muted-foreground transition-transform",
                            isCollapsed && "-rotate-90"
                          )}
                        />
                        <StatusIcon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="text-sm font-semibold">
                          {statusLabels[status]}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {statusCounts.get(status) ?? issues.length}
                        </span>
                      </button>
                      <div
                        id={groupContentId}
                        className="divide-y"
                        hidden={isCollapsed}
                      >
                        {issues.map((issue) => (
                          <IssueRow
                            key={issue.id}
                            issue={issue}
                            isBlocked={blockedIssueIds.has(issue.id)}
                          />
                        ))}
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
