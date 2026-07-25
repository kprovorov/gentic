import * as React from "react"

import { Marker, MarkerContent, MarkerIcon } from "@gentic/ui"

// NOTE: do NOT import from "@tabler/icons-react" in preview .tsx files —
// esbuild's targeted preview-rebuild enters runaway memory growth (observed
// 14GB+ RSS) when bundling named imports from that package here. Use small
// inline SVGs instead. See .design-sync/NOTES.md.
function IconInfoCircle(props: React.SVGProps<SVGSVGElement>) {
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
      <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 8h.01M11 12h1v4h1" />
    </svg>
  )
}

export function EmptyState() {
  return (
    <div style={{ maxWidth: 360 }}>
      <Marker variant="border">
        <MarkerContent>
          No messages yet. Move this issue to Queued to start the agent.
        </MarkerContent>
      </Marker>
    </div>
  )
}

export function WithIcon() {
  return (
    <div style={{ maxWidth: 360 }}>
      <Marker>
        <MarkerIcon>
          <IconInfoCircle />
        </MarkerIcon>
        <MarkerContent>Agent is working…</MarkerContent>
      </Marker>
    </div>
  )
}

export function Separator() {
  return (
    <div style={{ maxWidth: 360 }}>
      <Marker variant="separator">
        <MarkerContent>Today</MarkerContent>
      </Marker>
    </div>
  )
}
