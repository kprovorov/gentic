import assert from "node:assert/strict"
import { test } from "node:test"

import { formatAgentProviders, parseAgentProviders } from "./agents.js"
import { checkGithub, formatToolStatus, getToolStatuses } from "./tools.js"

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

test("checkGithub reports gh missing", async () => {
  const status = await checkGithub(async () => ({
    code: null,
    stdout: "",
    missing: true,
  }))

  assert.deepEqual(status, {
    installed: false,
    authenticated: false,
    version: null,
  })
})

test("checkGithub reports gh installed but not authenticated", async () => {
  const status = await checkGithub(async (command, args) => {
    assert.equal(command, "gh")
    if (args[0] === "--version") {
      return { code: 0, stdout: "gh version 2.74.2\n", missing: false }
    }
    return { code: 1, stdout: "", missing: false }
  })

  assert.deepEqual(status, {
    installed: true,
    authenticated: false,
    version: "2.74.2",
  })
})

test("checkGithub reports gh installed and authenticated", async () => {
  const status = await checkGithub(async (_command, args) => {
    if (args[0] === "--version") {
      return { code: 0, stdout: "gh version 2.74.2\n", missing: false }
    }
    return { code: 0, stdout: "", missing: false }
  })

  assert.deepEqual(status, {
    installed: true,
    authenticated: true,
    version: "2.74.2",
  })
})

test("getToolStatuses checks only selected agent CLIs", async () => {
  const commands: string[] = []

  const statuses = await getToolStatuses(["codex"], async (command, args) => {
    commands.push([command, ...args].join(" "))
    if (command === "gh" && args[0] === "--version") {
      return { code: 0, stdout: "gh version 2.74.2\n", missing: false }
    }
    if (command === "codex" && args[0] === "--version") {
      return { code: 0, stdout: "codex-cli 1.2.3\n", missing: false }
    }
    return { code: 0, stdout: "", missing: false }
  })

  assert.deepEqual(commands, [
    "gh --version",
    "codex --version",
    "gh auth status",
    "codex login status",
  ])
  assert.equal(statuses.claude, undefined)
  assert.equal(statuses.codex?.authenticated, true)
})

test("getToolStatuses checks both agent CLIs when both are selected", async () => {
  const commands: string[] = []

  await getToolStatuses(["claude_code", "codex"], async (command, args) => {
    commands.push([command, ...args].join(" "))
    if (command === "gh" && args[0] === "--version") {
      return { code: 0, stdout: "gh version 2.74.2\n", missing: false }
    }
    if (command === "claude" && args[0] === "--version") {
      return { code: 0, stdout: "1.0.0\n", missing: false }
    }
    if (command === "claude") {
      return { code: 0, stdout: '{"loggedIn":true}', missing: false }
    }
    if (command === "codex" && args[0] === "--version") {
      return { code: 0, stdout: "codex-cli 1.2.3\n", missing: false }
    }
    return { code: 0, stdout: "", missing: false }
  })

  assert.deepEqual(new Set(commands), new Set([
    "gh --version",
    "claude --version",
    "codex --version",
    "gh auth status",
    "claude auth status --json",
    "codex login status",
  ]))
})
