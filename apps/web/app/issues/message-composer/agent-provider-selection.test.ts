import assert from "node:assert/strict"
import { test } from "node:test"

import {
  buildAgentSwitchConfirmMessage,
  resolveAgentProviderSelection,
} from "./agent-provider-selection"

test("resolveAgentProviderSelection is a no-op when re-selecting the active provider", () => {
  assert.deepEqual(
    resolveAgentProviderSelection({
      currentProvider: "claude_code",
      nextProvider: "claude_code",
      hasMessages: true,
    }),
    { type: "noop" }
  )
  assert.deepEqual(
    resolveAgentProviderSelection({
      currentProvider: "claude_code",
      nextProvider: "claude_code",
      hasMessages: false,
    }),
    { type: "noop" }
  )
})

test("resolveAgentProviderSelection applies freely when there are no messages yet", () => {
  assert.deepEqual(
    resolveAgentProviderSelection({
      currentProvider: "claude_code",
      nextProvider: "codex",
      hasMessages: false,
    }),
    { type: "apply", requiresReset: false }
  )
})

test("resolveAgentProviderSelection requires a reset once messages exist", () => {
  assert.deepEqual(
    resolveAgentProviderSelection({
      currentProvider: "claude_code",
      nextProvider: "codex",
      hasMessages: true,
    }),
    { type: "apply", requiresReset: true }
  )
})

test("buildAgentSwitchConfirmMessage names the target agent", () => {
  assert.equal(
    buildAgentSwitchConfirmMessage("Codex"),
    "Switch to Codex? This resets the conversation and starts a fresh run."
  )
})
