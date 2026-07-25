import * as React from "react"

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
const IconCircleDashed = svgIcon(
  "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z"
)
const IconDownload = svgIcon(
  "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"
)

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@gentic/ui"

const rows = [
  {
    title: "Fix login redirect bug",
    status: "In progress",
    statusColor: "text-blue-600 dark:text-blue-300",
    StatusIcon: IconClock,
    assignee: "gentic-agent",
  },
  {
    title: "Add rate limiting to public API",
    status: "Queued",
    statusColor: "text-primary",
    StatusIcon: IconDownload,
    assignee: "Unassigned",
  },
  {
    title: "Improve empty state on /issues",
    status: "To do",
    statusColor: "text-muted-foreground",
    StatusIcon: IconCircleDashed,
    assignee: "kirill",
  },
]

export function Default() {
  return (
    <Table style={{ maxWidth: 480 }}>
      <TableCaption>3 open issues in gentic/web</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Assignee</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.title}>
            <TableCell className="font-medium">{row.title}</TableCell>
            <TableCell>
              <span
                className={`inline-flex items-center gap-1.5 ${row.statusColor}`}
              >
                <row.StatusIcon className="size-4" />
                {row.status}
              </span>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {row.assignee}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={2}>Total</TableCell>
          <TableCell>3 issues</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  )
}
