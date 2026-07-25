import assert from "node:assert/strict"
import { test } from "node:test"

import { formatAgentProviders, parseAgentProviders } from "./agents.js"
import { formatToolStatus } from "./tools.js"

test("formatToolStatus reports a missing CLI", () => {
  assert.equal(
    formatToolStatus({ installed: false, authenticated: false, version: null }),
    "not installed"
  )
})

test("formatToolStatus reports an installed but unauthenticated CLI", () => {
  assert.equal(
    formatToolStatus({
      installed: true,
      authenticated: false,
      version: "1.0.0",
    }),
    "installed, not authenticated"
  )
})

test("formatToolStatus reports an installed and authenticated CLI", () => {
  assert.equal(
    formatToolStatus({
      installed: true,
      authenticated: true,
      version: "1.0.0",
    }),
    "installed, authenticated"
  )
})

test("parseAgentProviders defaults to Claude Code", () => {
  assert.deepEqual(parseAgentProviders(undefined), ["claude_code"])
})

test("parseAgentProviders accepts the combined single-select value", () => {
  assert.deepEqual(parseAgentProviders("claude_code,codex"), [
    "claude_code",
    "codex",
  ])
})

test("formatAgentProviders labels the selected providers", () => {
  assert.equal(
    formatAgentProviders(["claude_code", "codex"]),
    "Claude Code, Codex"
  )
})
