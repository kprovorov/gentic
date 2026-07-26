import type { AgentProvider } from "@gentic/validators/issues"

export const agentProviderOptions: Array<{
  value: AgentProvider
  label: string
}> = [
  { value: "claude_code", label: "Claude Code" },
  { value: "codex", label: "Codex" },
]

export const agentProviderLabels: Record<AgentProvider, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
}

export function confirmRetryWithAgent(agentLabel: string): boolean {
  return window.confirm(
    `Retry with ${agentLabel}? This deletes the conversation and starts a fresh run.`
  )
}
