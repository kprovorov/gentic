import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"

import type {
  HostToolUpdateCommand,
  ReportHostToolUpdateResultInput,
} from "@gentic/validators/host-tool-updates"

import type { AgentApi } from "../api.js"
import {
  buildToolUpdatePlan,
  createToolUpdateRunner,
  detectGenticInstallChannel,
  runToolUpdate,
  type SpawnProcess,
  type UpdateEnvironment,
} from "../tool-updates.js"

const command: HostToolUpdateCommand = {
  id: "55555555-5555-4555-8555-555555555555",
  tool: "github",
  expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
}

function environment(
  overrides: Partial<UpdateEnvironment> = {}
): UpdateEnvironment {
  return {
    platform: "linux",
    packageManager: "apt-get",
    homebrew: false,
    root: false,
    genticInstall: "npm",
    genticVersion: "0.27.0",
    ...overrides,
  }
}

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  killed = false

  kill() {
    this.killed = true
    return true
  }
}

type Call = { command: string; args: string[]; env: NodeJS.ProcessEnv }

type Script = (
  call: Call,
  child: FakeChild
) => { code?: number | null; stdout?: string; stderr?: string; hang?: true }

/**
 * A spawn whose every invocation is answered by `script`, so a test can play
 * the version probe and the update steps differently.
 */
function fakeSpawn(script: Script): {
  spawnProcess: SpawnProcess
  calls: Call[]
} {
  const calls: Call[] = []

  const spawnProcess = ((
    spawned: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv }
  ) => {
    const call = { command: spawned, args, env: options.env }
    calls.push(call)
    const child = new FakeChild()
    setImmediate(() => {
      const answer = script(call, child)
      if (answer.hang) return
      if (answer.stdout) child.stdout.emit("data", Buffer.from(answer.stdout))
      if (answer.stderr) child.stderr.emit("data", Buffer.from(answer.stderr))
      child.emit("close", answer.code ?? 0)
    })
    return child
  }) as unknown as SpawnProcess

  return { spawnProcess, calls }
}

test("recognises where the running gentic was installed from", () => {
  assert.equal(
    detectGenticInstallChannel({
      argv: ["/usr/bin/node", "/usr/lib/node_modules/gentic-cli/bin/gentic.js"],
      entryPath: "/usr/lib/node_modules/gentic-cli/bin/gentic.js",
    }),
    "npm"
  )
  assert.equal(
    detectGenticInstallChannel({
      argv: ["node", "x"],
      entryPath:
        "/home/ada/.local/share/pnpm/global/5/node_modules/gentic-cli/bin/gentic.js",
    }),
    "pnpm"
  )
  assert.equal(
    detectGenticInstallChannel({
      argv: ["bun", "x"],
      entryPath:
        "/home/ada/.bun/install/global/node_modules/gentic-cli/bin/gentic.js",
    }),
    "bun"
  )
  assert.equal(
    detectGenticInstallChannel({
      argv: ["/opt/gentic/gentic", "/$bunfs/root/cli.js"],
      entryPath: "/$bunfs/root/tool-updates.js",
    }),
    "binary"
  )
  assert.equal(
    detectGenticInstallChannel({
      argv: ["node", "/srv/gentic/apps/gentic/dist/cli.js"],
      entryPath: "/srv/gentic/apps/gentic/dist/tool-updates.js",
    }),
    "source"
  )
})

test("updates each tool the way onboarding installed it, without a shell", () => {
  const apt = buildToolUpdatePlan("github", environment())
  assert.ok(apt.supported)
  assert.deepEqual(
    apt.steps.map((step) => [step.command, ...step.args]),
    [
      ["sudo", "-n", "apt-get", "update"],
      ["sudo", "-n", "apt-get", "install", "-y", "--only-upgrade", "gh"],
    ]
  )
  assert.equal(apt.steps[0].env?.DEBIAN_FRONTEND, "noninteractive")

  const rootDnf = buildToolUpdatePlan(
    "github",
    environment({ packageManager: "dnf", root: true })
  )
  assert.ok(rootDnf.supported)
  assert.deepEqual(
    rootDnf.steps.map((step) => [step.command, ...step.args]),
    [["dnf", "upgrade", "-y", "gh"]]
  )

  const brewGh = buildToolUpdatePlan(
    "github",
    environment({ platform: "darwin", homebrew: true, packageManager: null })
  )
  assert.ok(brewGh.supported)
  assert.deepEqual(
    brewGh.steps.map((step) => [step.command, ...step.args]),
    [["brew", "upgrade", "gh"]]
  )
  assert.equal(brewGh.steps[0].env?.NONINTERACTIVE, "1")

  const noBrew = buildToolUpdatePlan(
    "github",
    environment({ platform: "darwin", homebrew: false, packageManager: null })
  )
  assert.ok(!noBrew.supported)
  assert.match(noBrew.reason, /Homebrew was not found/)

  const noManager = buildToolUpdatePlan(
    "github",
    environment({ packageManager: null })
  )
  assert.ok(!noManager.supported)

  const claude = buildToolUpdatePlan("claude_code", environment())
  assert.ok(claude.supported)
  assert.deepEqual(
    claude.steps.map((step) => [step.command, ...step.args]),
    [["claude", "update"]]
  )

  const codexLinux = buildToolUpdatePlan("codex", environment())
  assert.ok(codexLinux.supported)
  assert.deepEqual(
    codexLinux.steps.map((step) => [step.command, ...step.args]),
    [["npm", "install", "-g", "@openai/codex@latest"]]
  )
  const codexMac = buildToolUpdatePlan(
    "codex",
    environment({ platform: "darwin", homebrew: true })
  )
  assert.ok(codexMac.supported)
  assert.deepEqual(
    codexMac.steps.map((step) => [step.command, ...step.args]),
    [["brew", "upgrade", "codex"]]
  )

  for (const [channel, expected] of [
    ["npm", ["npm", "install", "-g", "gentic-cli@latest"]],
    ["pnpm", ["pnpm", "add", "-g", "gentic-cli@latest"]],
    ["bun", ["bun", "add", "-g", "gentic-cli@latest"]],
  ] as const) {
    const plan = buildToolUpdatePlan(
      "gentic",
      environment({ genticInstall: channel })
    )
    assert.ok(plan.supported, channel)
    assert.deepEqual(
      plan.steps.map((step) => [step.command, ...step.args]),
      [expected]
    )
  }
  for (const channel of ["binary", "source"] as const) {
    const plan = buildToolUpdatePlan(
      "gentic",
      environment({ genticInstall: channel })
    )
    assert.ok(!plan.supported, channel)
  }
})

test("a clean update reports the version change and keeps the output private", async () => {
  let probes = 0
  const { spawnProcess, calls } = fakeSpawn((call) => {
    if (call.command === "gh") {
      probes += 1
      return {
        stdout: `gh version ${probes === 1 ? "2.60.0" : "2.61.0"} (2026-09-01)\n`,
      }
    }
    return { stdout: "Reading package lists... in /home/ada\n" }
  })

  const outcome = await runToolUpdate(command, {
    spawnProcess,
    environment: environment({ root: true }),
  })

  assert.deepEqual(outcome, {
    report: {
      status: "updated",
      summary: "Updated from 2.60.0 to 2.61.0.",
      output: null,
      version: "2.61.0",
    },
    restartRequired: false,
  })
  assert.deepEqual(
    calls.map((call) => [call.command, ...call.args]),
    [
      ["gh", "--version"],
      ["apt-get", "update"],
      ["apt-get", "install", "-y", "--only-upgrade", "gh"],
      ["gh", "--version"],
    ]
  )
})

test("an unchanged version is reported as already up to date", async () => {
  const { spawnProcess } = fakeSpawn((call) =>
    call.command === "claude"
      ? call.args[0] === "--version"
        ? { stdout: "2.0.1 (Claude Code)\n" }
        : { stdout: "Already up to date\n" }
      : { code: 1 }
  )

  const outcome = await runToolUpdate(
    { ...command, tool: "claude_code" },
    { spawnProcess, environment: environment() }
  )

  assert.equal(outcome.report.status, "updated")
  assert.equal(outcome.report.summary, "Already up to date (2.0.1).")
  assert.equal(outcome.report.version, "2.0.1")
})

test("a failed step reports the exit code with the captured output", async () => {
  const { spawnProcess } = fakeSpawn((call) =>
    call.command === "sudo"
      ? { code: 1, stderr: "sudo: a password is required\n" }
      : { stdout: "gh version 2.60.0\n" }
  )

  const outcome = await runToolUpdate(command, {
    spawnProcess,
    environment: environment(),
  })

  assert.equal(outcome.report.status, "failed")
  assert.equal(
    outcome.report.summary,
    "sudo -n apt-get update exited with code 1."
  )
  assert.match(outcome.report.output ?? "", /a password is required/)
  assert.equal(outcome.report.version, null)
})

test("a missing updater and an unsupported channel are ordinary failures", async () => {
  const { spawnProcess } = fakeSpawn((call, child) => {
    if (call.command === "npm") {
      const error: NodeJS.ErrnoException = new Error("spawn npm ENOENT")
      error.code = "ENOENT"
      setImmediate(() => child.emit("error", error))
      return { hang: true }
    }
    return { stdout: "0.27.0\n" }
  })

  const missing = await runToolUpdate(
    { ...command, tool: "gentic" },
    { spawnProcess, environment: environment() }
  )
  assert.equal(missing.report.status, "failed")
  assert.equal(missing.report.summary, "npm is not available on this host.")

  const unsupported = await runToolUpdate(
    { ...command, tool: "gentic" },
    { spawnProcess, environment: environment({ genticInstall: "binary" }) }
  )
  assert.equal(unsupported.report.status, "failed")
  assert.match(unsupported.report.summary ?? "", /standalone gentic binary/)
})

test("an update still running at expiry is killed and reported", async () => {
  const started: FakeChild[] = []
  const { spawnProcess } = fakeSpawn((call, child) => {
    if (call.command === "gh") return { stdout: "gh version 2.60.0\n" }
    started.push(child)
    return { hang: true }
  })

  const outcome = await runToolUpdate(
    { ...command, expires_at: new Date(Date.now() - 60_000).toISOString() },
    { spawnProcess, environment: environment({ root: true }) }
  )

  assert.equal(outcome.report.status, "failed")
  assert.match(outcome.report.summary ?? "", /did not finish before/)
  assert.equal(started[0]?.killed, true)
})

test("a gentic update only asks for a restart when a different version landed", async () => {
  let installed = "0.27.0"
  const { spawnProcess } = fakeSpawn((call) => {
    if (call.command === "npm") {
      installed = "0.28.0"
      return { stdout: "changed 12 packages\n" }
    }
    return { stdout: `${installed}\n` }
  })

  const outcome = await runToolUpdate(
    { ...command, tool: "gentic" },
    { spawnProcess, environment: environment() }
  )

  assert.equal(outcome.restartRequired, true)
  assert.equal(
    outcome.report.summary,
    "Installed 0.28.0. The host restarts once its active tasks finish."
  )
  assert.equal(outcome.report.version, "0.28.0")

  const unchanged = await runToolUpdate(
    { ...command, tool: "gentic" },
    {
      spawnProcess,
      environment: environment({ genticVersion: "0.28.0" }),
    }
  )
  assert.equal(unchanged.restartRequired, false)
  assert.equal(unchanged.report.summary, "Already up to date (0.28.0).")
})

test("the runner claims one command at a time, sanitizes the report, then notifies", async () => {
  const claimed: HostToolUpdateCommand[] = []
  const reported: Array<{
    updateId: string
    result: ReportHostToolUpdateResultInput
  }> = []
  const events: Array<{ tool: string; restartRequired: boolean }> = []
  let pending: HostToolUpdateCommand | null = { ...command, tool: "gentic" }
  const finishRun: { release: () => void } = { release: () => {} }

  const api = {
    async claimToolUpdate() {
      const next = pending
      pending = null
      if (next) claimed.push(next)
      return next
    },
    async reportToolUpdate(
      updateId: string,
      result: ReportHostToolUpdateResultInput
    ) {
      reported.push({ updateId, result })
    },
  } as unknown as AgentApi

  const runner = createToolUpdateRunner(api, {
    run: async () =>
      new Promise((resolve) => {
        finishRun.release = () =>
          resolve({
            report: {
              status: "updated",
              summary: "Installed 0.28.0 under /home/ada/.npm-global.",
              output: null,
              version: "0.28.0",
            },
            restartRequired: true,
          })
      }),
    onUpdated: async (event) => {
      // The report must have been delivered before the loop is told.
      assert.equal(reported.length, 1)
      events.push(event)
    },
  })

  await runner.poll()
  // A second tick while the first update is still running must not claim
  // again: only one update may be in flight per host.
  pending = { ...command, id: "second", tool: "codex" }
  await runner.poll()
  assert.deepEqual(
    claimed.map((entry) => entry.id),
    [command.id]
  )

  finishRun.release()
  await runner.drain()

  assert.equal(reported.length, 1)
  assert.equal(reported[0].updateId, command.id)
  assert.equal(
    reported[0].result.summary,
    "Installed 0.28.0 under ~/.npm-global."
  )
  assert.deepEqual(events, [{ tool: "gentic", restartRequired: true }])
})

test("a failed update reports but never notifies, and a failed claim is retried", async () => {
  const events: unknown[] = []
  let attempts = 0
  const api = {
    async claimToolUpdate() {
      attempts += 1
      if (attempts === 1) throw new Error("control channel unavailable")
      return attempts === 2 ? command : null
    },
    async reportToolUpdate() {},
  } as unknown as AgentApi

  const runner = createToolUpdateRunner(api, {
    run: async () => ({
      report: { status: "failed", summary: "nope", output: "", version: null },
      restartRequired: false,
    }),
    onUpdated: (event) => {
      events.push(event)
    },
  })

  await runner.poll()
  await runner.poll()
  await runner.drain()

  assert.equal(attempts, 2)
  assert.deepEqual(events, [])
})
