import * as React from "react"

// NOTE: do NOT import from "@tabler/icons-react" in preview .tsx files —
// esbuild's targeted preview-rebuild enters runaway memory growth (observed
// 14GB+ RSS) when bundling named imports from that package here, even
// though the same imports are fine inside packages/ui/src itself (bundled
// via the main package-build.mjs entry, a different esbuild invocation).
// Use small inline SVGs instead. See .design-sync/NOTES.md.
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
const IconCheck = svgIcon("M20 6 9 17l-5-5")
const IconChevronDown = svgIcon("m6 9 6 6 6-6")
const IconCopy = svgIcon(
  "M9 9h10v10H9zM5 15V5a2 2 0 0 1 2-2h10"
)
const IconPencil = svgIcon(
  "M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5Z"
)
const IconTrash = svgIcon(
  "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"
)

import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@gentic/ui"

const statusIconStyles = {
  todo: "text-muted-foreground",
  "in-progress": "text-blue-500",
  done: "text-emerald-500",
}

// Row-actions menu, ported from apps/web/app/issues/issues-view.tsx's
// IssueStatusMenu + bulk-actions-toolbar.tsx: a trigger button, a plain
// item list, and a destructive item after a separator. Forced open (no
// onOpenChange) so the content renders for a static screenshot.
export function RowActions() {
  return (
    <div style={{ paddingBottom: 220 }}>
      <DropdownMenu open>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            Actions
            <IconChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Fix login redirect bug</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem className="gap-3">
              <IconPencil className="size-4" />
              <span className="min-w-0 flex-1 truncate">Edit</span>
              <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-3">
              <IconCopy className="size-4" />
              <span className="min-w-0 flex-1 truncate">Duplicate</span>
              <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" className="gap-3">
            <IconTrash className="size-4" />
            <span className="min-w-0 flex-1 truncate">Delete</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// Status filter menu, ported from issues-view.tsx's status-filter dropdown:
// checkbox items reflecting a multi-select filter state, plus a "clear
// filter" item gated behind a separator.
export function CheckboxFilter() {
  const options: { value: string; label: string }[] = [
    { value: "todo", label: "Todo" },
    { value: "in-progress", label: "In progress" },
    { value: "done", label: "Done" },
  ]

  return (
    <div style={{ paddingBottom: 220 }}>
      <DropdownMenu open>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            Status
            <span className="ml-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-xs font-medium text-primary">
              2
            </span>
            <IconChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuItem>Clear filter</DropdownMenuItem>
          <DropdownMenuSeparator />
          {options.map((option, index) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={index < 2}
              className="gap-3"
            >
              <span
                className={`size-2 rounded-full ${
                  option.value === "done"
                    ? "bg-emerald-500"
                    : option.value === "in-progress"
                      ? "bg-blue-500"
                      : "bg-muted-foreground"
                }`}
              />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// Radio-group sort menu plus a submenu ("More") — exercises
// DropdownMenuRadioGroup/RadioItem and DropdownMenuSub/SubTrigger/SubContent
// (rendered force-open via defaultOpen so the nested panel is visible too).
export function RadioAndSubmenu() {
  return (
    <div style={{ paddingBottom: 260, paddingRight: 160 }}>
      <DropdownMenu open>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            Sort by
            <IconChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          <DropdownMenuRadioGroup value="created">
            <DropdownMenuRadioItem value="created">
              Date created
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="updated">
              Last updated
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="priority">
              Priority
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuSub defaultOpen>
            <DropdownMenuSubTrigger>More options</DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent className="w-44">
                <DropdownMenuItem className="gap-3">
                  <IconCheck className="size-4" />
                  <span className="min-w-0 flex-1 truncate">
                    Mark all read
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem>Export CSV</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
