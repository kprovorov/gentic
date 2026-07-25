export const agentProviders = ["claude_code", "codex"] as const

export type AgentProvider = (typeof agentProviders)[number]

export const DEFAULT_AGENT_PROVIDERS: AgentProvider[] = ["claude_code"]

export const agentProviderLabels: Record<AgentProvider, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
}

export function parseAgentProviders(value: unknown): AgentProvider[] {
  const values =
    typeof value === "string"
      ? value.split(",").map((item) => item.trim())
      : Array.isArray(value)
        ? value
        : DEFAULT_AGENT_PROVIDERS
  const selected = values.filter((item): item is AgentProvider =>
    agentProviders.includes(item as AgentProvider)
  )
  return selected.length > 0 ? [...new Set(selected)] : DEFAULT_AGENT_PROVIDERS
}

export function formatAgentProviders(providers: AgentProvider[]): string {
  return providers.map((provider) => agentProviderLabels[provider]).join(", ")
}
