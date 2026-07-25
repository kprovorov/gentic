export const agentProviders = ["claude_code", "codex"] as const

export type AgentProvider = (typeof agentProviders)[number]

export const agentProviderLabels: Record<AgentProvider, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
}

export function formatAgentProviders(providers: AgentProvider[]): string {
  return providers.map((provider) => agentProviderLabels[provider]).join(", ")
}
