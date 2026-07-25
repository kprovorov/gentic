import * as React from "react"

import { ToggleGroup, ToggleGroupItem } from "@gentic/ui"

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
const IconList = svgIcon("M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01")
const IconTable = svgIcon(
  "M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5ZM3 10h18M10 3v18"
)
const IconBold = svgIcon(
  "M7 5h6a3.5 3.5 0 0 1 0 7H7ZM7 12h7a3.5 3.5 0 0 1 0 7H7Z"
)
const IconItalic = svgIcon("M19 4h-9M14 20H5M15 4 9 20")
const IconUnderline = svgIcon("M6 4v6a6 6 0 0 0 12 0V4M5 20h14")

export function ViewSwitcher() {
  return (
    <ToggleGroup type="single" variant="outline" defaultValue="table">
      <ToggleGroupItem value="list" aria-label="List view">
        <IconList />
      </ToggleGroupItem>
      <ToggleGroupItem value="table" aria-label="Table view">
        <IconTable />
      </ToggleGroupItem>
    </ToggleGroup>
  )
}

export function MultiSelect() {
  return (
    <ToggleGroup type="multiple" defaultValue={["bold"]}>
      <ToggleGroupItem value="bold" aria-label="Bold">
        <IconBold />
      </ToggleGroupItem>
      <ToggleGroupItem value="italic" aria-label="Italic">
        <IconItalic />
      </ToggleGroupItem>
      <ToggleGroupItem value="underline" aria-label="Underline">
        <IconUnderline />
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
