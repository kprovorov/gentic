import assert from "node:assert/strict"
import { test } from "node:test"

import {
  buildAgentModelSwitchConfirmMessage,
  resolveAgentModelSelection,
} from "./agent-model-selection"

test("resolveAgentModelSelection is a no-op when re-selecting the active pair", () => {
  assert.deepEqual(
    resolveAgentModelSelection({
      currentProvider: "claude_code",
      currentModel: "claude-sonnet-5",
      nextProvider: "claude_code",
      nextModel: "claude-sonnet-5",
      hasMessages: true,
    }),
    { type: "noop" }
  )
  assert.deepEqual(
    resolveAgentModelSelection({
      currentProvider: "claude_code",
      currentModel: null,
      nextProvider: "claude_code",
      nextModel: null,
      hasMessages: false,
    }),
    { type: "noop" }
  )
})

test("resolveAgentModelSelection applies freely when there are no messages yet", () => {
  assert.deepEqual(
    resolveAgentModelSelection({
      currentProvider: "claude_code",
      currentModel: null,
      nextProvider: "codex",
      nextModel: "gpt-5.6",
      hasMessages: false,
    }),
    { type: "apply", requiresReset: false }
  )
})

test("resolveAgentModelSelection requires a reset once messages exist", () => {
  assert.deepEqual(
    resolveAgentModelSelection({
      currentProvider: "claude_code",
      currentModel: null,
      nextProvider: "codex",
      nextModel: "gpt-5.6",
      hasMessages: true,
    }),
    { type: "apply", requiresReset: true }
  )
})

test("resolveAgentModelSelection requires a reset for a model-only change", () => {
  assert.deepEqual(
    resolveAgentModelSelection({
      currentProvider: "claude_code",
      currentModel: "claude-sonnet-5",
      nextProvider: "claude_code",
      nextModel: "claude-opus-5",
      hasMessages: true,
    }),
    { type: "apply", requiresReset: true }
  )
})

test("buildAgentModelSwitchConfirmMessage names the target agent when it changes", () => {
  assert.equal(
    buildAgentModelSwitchConfirmMessage({
      providerChanged: true,
      agentLabel: "Codex",
    }),
    "Switch to Codex? This resets the conversation and starts a fresh run."
  )
})

test("buildAgentModelSwitchConfirmMessage stays generic for a model-only change", () => {
  assert.equal(
    buildAgentModelSwitchConfirmMessage({
      providerChanged: false,
      agentLabel: "Claude Code",
    }),
    "Switch model? This resets the conversation and starts a fresh run."
  )
})
