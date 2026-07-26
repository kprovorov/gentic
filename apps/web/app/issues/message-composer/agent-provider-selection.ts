import type { AgentProvider } from "@gentic/validators/issues"

export type AgentProviderSelectionResult =
  | { type: "noop" }
  | { type: "apply"; requiresReset: boolean }

/**
 * Decides what should happen when a user picks an agent provider in the
 * composer: switching to the already-active provider is a no-op, switching
 * before any messages exist applies immediately, and switching once a
 * conversation exists requires resetting it (see resetIssueAgent).
 */
export function resolveAgentProviderSelection({
  currentProvider,
  nextProvider,
  hasMessages,
}: {
  currentProvider: AgentProvider
  nextProvider: AgentProvider
  hasMessages: boolean
}): AgentProviderSelectionResult {
  if (nextProvider === currentProvider) {
    return { type: "noop" }
  }

  return { type: "apply", requiresReset: hasMessages }
}

export function buildAgentSwitchConfirmMessage(agentLabel: string): string {
  return `Switch to ${agentLabel}? This resets the conversation and starts a fresh run.`
}
