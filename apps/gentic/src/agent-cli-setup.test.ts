import assert from "node:assert/strict"
import { test } from "node:test"

import {
  setupSelectedAgentCLIs,
  type AgentCliSetupDeps,
} from "./agent-cli-setup.js"

const ready = { installed: true, authenticated: true, version: "1.0.0" }
const missing = { installed: false, authenticated: false, version: null }

test("skips codex setup when codex is not selected", async () => {
  const deps = fakeDeps()

  const completed = await setupSelectedAgentCLIs(
    ["claude_code"],
    {
      github: ready,
      claude: ready,
    },
    deps
  )

  assert.equal(completed, true)
  assert.deepEqual(deps.prompts, [])
  assert.deepEqual(deps.commands, [])
})

test("skips claude setup when claude is installed and authenticated", async () => {
  const deps = fakeDeps()

  const completed = await setupSelectedAgentCLIs(
    ["claude_code"],
    {
      github: ready,
      claude: ready,
    },
    deps
  )

  assert.equal(completed, true)
  assert.deepEqual(deps.prompts, [])
  assert.deepEqual(deps.commands, [])
})

test("installs claude with the official installer then runs auth login", async () => {
  const deps = fakeDeps()

  const completed = await setupSelectedAgentCLIs(
    ["claude_code"],
    {
      github: ready,
      claude: missing,
    },
    deps
  )

  assert.equal(completed, true)
  assert.deepEqual(deps.prompts, [
    "Claude Code is not installed. Run `curl -fsSL https://claude.ai/install.sh | bash` now?",
    "Claude Code is not authenticated. Run `claude auth login` now?",
  ])
  assert.deepEqual(deps.commands, [
    {
      command: "bash",
      args: ["-lc", "curl -fsSL https://claude.ai/install.sh | bash"],
    },
    { command: "claude", args: ["auth", "login"] },
  ])
})

test("runs claude auth login when installed but not authenticated", async () => {
  const deps = fakeDeps()

  await setupSelectedAgentCLIs(
    ["claude_code"],
    {
      github: ready,
      claude: { installed: true, authenticated: false, version: "1.0.0" },
    },
    deps
  )

  assert.deepEqual(deps.prompts, [
    "Claude Code is not authenticated. Run `claude auth login` now?",
  ])
  assert.deepEqual(deps.commands, [
    { command: "claude", args: ["auth", "login"] },
  ])
})

test("declining claude setup skips that agent without cancelling onboarding", async () => {
  const deps = fakeDeps({ answers: [false] })

  const completed = await setupSelectedAgentCLIs(
    ["claude_code", "codex"],
    {
      github: ready,
      claude: missing,
      codex: ready,
    },
    deps
  )

  assert.equal(completed, true)
  assert.equal(deps.cancelled, false)
  assert.deepEqual(deps.commands, [])
})

test("skips codex setup when codex is installed and authenticated", async () => {
  const deps = fakeDeps()

  const completed = await setupSelectedAgentCLIs(
    ["codex"],
    {
      github: ready,
      codex: ready,
    },
    deps
  )

  assert.equal(completed, true)
  assert.deepEqual(deps.prompts, [])
  assert.deepEqual(deps.commands, [])
})

test("installs codex with Homebrew on macOS then runs login", async () => {
  const deps = fakeDeps({ platform: "darwin" })

  const completed = await setupSelectedAgentCLIs(
    ["codex"],
    {
      github: ready,
      codex: missing,
    },
    deps
  )

  assert.equal(completed, true)
  assert.deepEqual(deps.prompts, [
    "Codex CLI is not installed. Run `brew install codex` now?",
    "Codex CLI is not authenticated. Run `codex login` now?",
  ])
  assert.deepEqual(deps.commands, [
    { command: "brew", args: ["install", "codex"] },
    { command: "codex", args: ["login"] },
  ])
})

test("installs codex with npm on Linux then runs login", async () => {
  const deps = fakeDeps({ platform: "linux" })

  await setupSelectedAgentCLIs(
    ["codex"],
    {
      github: ready,
      codex: missing,
    },
    deps
  )

  assert.deepEqual(deps.commands, [
    { command: "npm", args: ["install", "-g", "@openai/codex"] },
    { command: "codex", args: ["login"] },
  ])
})

test("runs codex login when installed but not authenticated", async () => {
  const deps = fakeDeps()

  await setupSelectedAgentCLIs(
    ["codex"],
    {
      github: ready,
      codex: { installed: true, authenticated: false, version: "1.0.0" },
    },
    deps
  )

  assert.deepEqual(deps.prompts, [
    "Codex CLI is not authenticated. Run `codex login` now?",
  ])
  assert.deepEqual(deps.commands, [{ command: "codex", args: ["login"] }])
})

test("returns false when the install prompt is cancelled", async () => {
  const cancelSymbol = Symbol("cancel")
  const deps = fakeDeps({ answers: [cancelSymbol], cancelSymbol })

  const completed = await setupSelectedAgentCLIs(
    ["codex"],
    {
      github: ready,
      codex: missing,
    },
    deps
  )

  assert.equal(completed, false)
  assert.equal(deps.cancelled, true)
  assert.deepEqual(deps.commands, [])
})

function fakeDeps(opts: {
  platform?: "darwin" | "linux"
  answers?: Array<boolean | symbol>
  cancelSymbol?: symbol
} = {}): AgentCliSetupDeps & {
  prompts: string[]
  commands: { command: string; args: string[] }[]
  cancelled: boolean
} {
  const prompts: string[] = []
  const commands: { command: string; args: string[] }[] = []
  const answers = [...(opts.answers ?? [true, true])]
  let cancelled = false
  return {
    prompts,
    commands,
    get cancelled() {
      return cancelled
    },
    async confirm({ message }) {
      prompts.push(message)
      return answers.shift() ?? true
    },
    isCancel(value) {
      return value === opts.cancelSymbol
    },
    cancel() {
      cancelled = true
    },
    log: {
      info() {},
      warn() {},
      success() {},
    },
    detectPlatform() {
      return opts.platform ?? "linux"
    },
    async spawnInteractive(command, args) {
      commands.push({ command, args })
    },
  }
}
