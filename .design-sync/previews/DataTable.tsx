import * as React from "react"
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table"

import { Checkbox, DataTable } from "@gentic/ui"

// NOTE: do NOT import from "@tabler/icons-react" in preview .tsx files —
// esbuild's targeted preview-rebuild enters runaway memory growth (observed
// 14GB+ RSS) when bundling named imports from that package here. Use small
// inline SVGs instead. See .design-sync/NOTES.md.
function svgIcon(path: string) {
  return function Icon(props: React.SVGProps<SVGSVGElement>) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        width={16}
        height={16}
        {...props}
      >
        <path d={path} />
      </svg>
    )
  }
}
const IconClock = svgIcon("M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2")
const IconLoader2 = svgIcon("M12 3a9 9 0 1 0 9 9")
const IconCircleCheck = svgIcon(
  "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM9 12l2 2 4-4"
)

type Row = {
  id: string
  title: string
  status: "todo" | "in-progress" | "done"
  assignee: string
}

const statusLabels: Record<Row["status"], string> = {
  todo: "To do",
  "in-progress": "In progress",
  done: "Done",
}

const statusStyles: Record<Row["status"], string> = {
  todo: "bg-muted text-muted-foreground",
  "in-progress": "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  done: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
}

const statusIcons: Record<Row["status"], typeof IconClock> = {
  todo: IconClock,
  "in-progress": IconLoader2,
  done: IconCircleCheck,
}

const data: Row[] = [
  {
    id: "1",
    title: "Fix login redirect bug",
    status: "in-progress",
    assignee: "Codex",
  },
  {
    id: "2",
    title: "Add rate limiting to agent API",
    status: "todo",
    assignee: "Unassigned",
  },
  {
    id: "3",
    title: "Draft PR ready for review",
    status: "done",
    assignee: "Claude",
  },
  {
    id: "4",
    title: "Investigate flaky worker test",
    status: "todo",
    assignee: "Unassigned",
  },
]

// Ported from apps/web/app/issues/issues-view.tsx's table view: a small
// issue list with title/status/assignee columns, driven by a real
// @tanstack/react-table instance (DataTable is a thin renderer over
// `table`/`columns`, so a story must build a real table like the app does).
export function IssuesTable() {
  const columns: ColumnDef<Row>[] = [
    {
      id: "select",
      header: () => <Checkbox aria-label="Select all" />,
      cell: () => <Checkbox aria-label="Select row" />,
    },
    {
      accessorKey: "title",
      header: "Issue",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.title}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const status = row.original.status
        const Icon = statusIcons[status]

        return (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusStyles[status]}`}
          >
            <Icon className="size-3" />
            {statusLabels[status]}
          </span>
        )
      },
    },
    {
      accessorKey: "assignee",
      header: "Assignee",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.assignee}
        </span>
      ),
    },
  ]

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div
      className="overflow-hidden rounded-lg border bg-card shadow-sm"
      style={{ width: 560 }}
    >
      <DataTable table={table} columns={columns} />
    </div>
  )
}

// Empty state — the DataTable's own "No results." fallback row, driven by
// the same column shape with zero data rows.
export function Empty() {
  const columns: ColumnDef<Row>[] = [
    { accessorKey: "title", header: "Issue" },
    { accessorKey: "status", header: "Status" },
    { accessorKey: "assignee", header: "Assignee" },
  ]

  const table = useReactTable({
    data: [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div
      className="overflow-hidden rounded-lg border bg-card shadow-sm"
      style={{ width: 480 }}
    >
      <DataTable table={table} columns={columns} />
    </div>
  )
}
