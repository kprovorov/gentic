import {
  Anthropic,
  Claude,
  Github,
  Openai,
  OpenaiChatgpt,
  type SvgIconProps,
} from "@thesvg/react"

import type { AgentProvider } from "@gentic/validators/issues"

type BrandIconName = "anthropic" | "claude_code" | "codex" | "github" | "openai"

type BrandIconProps = Omit<SvgIconProps, "name"> & {
  name: BrandIconName
  tone?: "brand" | "mono"
}

type AgentProviderIconProps = Omit<SvgIconProps, "name" | "provider"> & {
  provider: AgentProvider
  tone?: "brand" | "mono"
}

export function BrandIcon({ name, tone = "brand", ...props }: BrandIconProps) {
  const variant = tone === "brand" ? "color" : "mono"

  if (name === "anthropic") {
    return <Anthropic variant="mono" aria-hidden="true" {...props} />
  }

  if (name === "claude_code") {
    return (
      <Claude
        variant={tone === "brand" ? "default" : "mono"}
        aria-hidden="true"
        {...props}
      />
    )
  }

  if (name === "codex") {
    return (
      <OpenaiChatgpt
        variant={tone === "brand" ? "default" : "mono"}
        aria-hidden="true"
        {...props}
      />
    )
  }

  if (name === "github") {
    return <Github variant="mono" aria-hidden="true" {...props} />
  }

  return (
    <Openai
      variant={tone === "brand" ? "default" : "dark"}
      aria-hidden="true"
      {...props}
    />
  )
}

export function AgentProviderIcon({
  provider,
  ...props
}: AgentProviderIconProps) {
  return (
    <BrandIcon
      name={provider === "claude_code" ? "claude_code" : "codex"}
      {...props}
    />
  )
}
