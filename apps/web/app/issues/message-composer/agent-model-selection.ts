import type { AgentProvider, IssueModel } from "@gentic/validators/issues"

export type AgentModelSelectionResult =
  | { type: "noop" }
  | { type: "apply"; requiresReset: boolean }

/**
 * Decides what should happen when a user picks an agent+model pair in the
 * composer: re-selecting the already-active pair is a no-op, picking a
 * different one before any messages exist applies immediately, and picking
 * one once a conversation exists requires resetting it (see
 * resetIssueAgent).
 */
export function resolveAgentModelSelection({
  currentProvider,
  currentModel,
  nextProvider,
  nextModel,
  hasMessages,
}: {
  currentProvider: AgentProvider
  currentModel: IssueModel
  nextProvider: AgentProvider
  nextModel: IssueModel
  hasMessages: boolean
}): AgentModelSelectionResult {
  if (nextProvider === currentProvider && nextModel === currentModel) {
    return { type: "noop" }
  }

  return { type: "apply", requiresReset: hasMessages }
}

export function buildAgentModelSwitchConfirmMessage({
  providerChanged,
  agentLabel,
}: {
  providerChanged: boolean
  agentLabel: string
}): string {
  return providerChanged
    ? `Switch to ${agentLabel}? This resets the conversation and starts a fresh run.`
    : "Switch model? This resets the conversation and starts a fresh run."
}
