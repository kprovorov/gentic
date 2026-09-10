import Image from "next/image"

const brandAssets = {
  claude: "/logos/claude.svg",
  codex: "/logos/openai.svg",
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
