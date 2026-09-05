import Image from "next/image"

const paths = {
  arrow: "M5 12h14m-6-6 6 6-6 6",
  branch:
    "M6 7v10m12-10v2a3 3 0 0 1-3 3H9m-3-9a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM18 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z",
  check: "m5 12 4 4L19 6",
  code: "m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16",
  issue: "M12 8v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  layers: "m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5",
  message:
    "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H3l1.6-4A8.5 8.5 0 1 1 21 11.5ZM8 10h8m-8 4h5",
  server:
    "M5 3h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm0 10h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2ZM7 7h.01M7 17h.01m5-10h5m-5 10h5",
  terminal: "m5 7 5 5-5 5m8 0h6",
  link: "m10 13 4-4m-6 6-1 1a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0m2 2 1-1a3.5 3.5 0 0 1 5 5l-4 4a3.5 3.5 0 0 1-5 0",
  plus: "M12 5v14M5 12h14",
  chevron: "m9 5 7 7-7 7",
  paperclip: "m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8m-2 11 6-6",
  globe:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18m-9-9c5 5 5 13 0 18-5-5-5-13 0-18Z",
} as const

export function Icon({
  name,
  className,
}: {
  name: keyof typeof paths
  className?: string
}) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  )
}

const brandAssets = {
  claude: "/logos/claude-code.svg",
  codex: "/logos/codex.svg",
  github: "/logos/github.svg",
  mcp: "/logos/mcp.svg",
} as const

export function BrandMark({
  brand,
  className = "",
}: {
  brand: keyof typeof brandAssets
  className?: string
}) {
  return (
    <Image
      className={`brand-mark ${className}`}
      src={brandAssets[brand]}
      width={24}
      height={24}
      alt=""
      aria-hidden="true"
      unoptimized
    />
  )
}

export function AgentMark({ provider }: { provider: "claude" | "codex" }) {
  return <BrandMark brand={provider} className="agent-mark" />
}
