import assert from "node:assert/strict"
import { test } from "node:test"

import { formatAgentProviders } from "./agents.js"
import { checkGithub, formatToolStatus, getToolStatuses } from "./tools.js"

interface CommandResult {
  code: number | null
  stdout: string
  missing: boolean
}

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

/** Stub run() covering every probe getToolStatuses makes. */
function stubRun(
  overrides: (command: string, args: string[]) => CommandResult | null = () =>
    null
) {
  const commands: string[] = []
  const run = async (command: string, args: string[]) => {
    commands.push([command, ...args].join(" "))
    const override = overrides(command, args)
    if (override) return override
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
    // The bundled Claude Code probe, whose command is an absolute path.
    if (args.includes("--cli") && args.includes("--version")) {
      return { code: 0, stdout: "2.1.274 (Claude Code)\n", missing: false }
    }
    return { code: 0, stdout: "", missing: false }
  }
  return { commands, run }
}

test("getToolStatuses checks all agent CLIs", async () => {
  const { commands, run } = stubRun()

  await getToolStatuses(run)

  const normalized = commands.map((command) =>
    command.includes("--cli") ? "<bundled claude> --cli --version" : command
  )
  assert.deepEqual(
    new Set(normalized),
    new Set([
      "gh --version",
      "claude --version",
      "codex --version",
      "gh auth status",
      "claude auth status --json",
      "codex login status",
      "<bundled claude> --cli --version",
    ])
  )
})

test("claude version reports the bundled binary, not the one on PATH", async () => {
  const { run } = stubRun((command, args) =>
    // PATH claude is a *different*, newer install than the bundled binary;
    // the reported version must be the bundled one, since that is what runs.
    command === "claude" && args[0] === "--version"
      ? { code: 0, stdout: "2.1.280 (Claude Code)\n", missing: false }
      : null
  )

  const tools = await getToolStatuses(run)

  assert.deepEqual(tools.claude, {
    installed: true,
    authenticated: true,
    version: "2.1.274",
  })
})

test("claude version survives a failing bundled-binary probe", async () => {
  const { run } = stubRun((_command, args) =>
    args.includes("--cli") ? { code: null, stdout: "", missing: true } : null
  )

  const tools = await getToolStatuses(run)

  assert.deepEqual(tools.claude, {
    installed: true,
    authenticated: true,
    version: null,
  })
})

test("claude reports not installed when the PATH CLI is missing", async () => {
  const { run } = stubRun((command) =>
    command === "claude" ? { code: null, stdout: "", missing: true } : null
  )

  const tools = await getToolStatuses(run)

  assert.deepEqual(tools.claude, {
    installed: false,
    authenticated: false,
    version: null,
  })
})
