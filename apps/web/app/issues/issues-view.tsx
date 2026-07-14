"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table"
import { IconPlus, IconSearch } from "@tabler/icons-react"

import { getIssuesData, type IssuesData } from "@/app/queries"
import { queryKeys } from "@/app/query-keys"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { Button } from "@gentic/ui/button"
import { DataTable } from "@gentic/ui/data-table"
import { Input } from "@gentic/ui/input"

import { getIssuesColumns } from "./issues-columns"

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
  const columns = useMemo(
    () => getIssuesColumns(blockedIssueIds),
    [blockedIssueIds]
  )
  const [sorting, setSorting] = useState<SortingState>([
    { id: "created_at", desc: true },
  ])
  const [globalFilter, setGlobalFilter] = useState("")

  const table = useReactTable({
    data: data.issues,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, _columnId, filterValue) => {
      const issue = row.original
      const haystack = [
        issue.title,
        issue.projects?.name,
        issue.projects?.repo,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return haystack.includes(String(filterValue).toLowerCase())
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 20 } },
  })

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
                onChange={(event) => setGlobalFilter(event.target.value)}
                placeholder="Search issues…"
                className="pl-9"
              />
            </div>
            <div className="overflow-hidden rounded-4xl border bg-card shadow-sm">
              <DataTable table={table} columns={columns} />
            </div>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {table.getFilteredRowModel().rows.length} issue
                {table.getFilteredRowModel().rows.length === 1 ? "" : "s"}
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
          </section>
        )}
      </div>
    </div>
  )
}
