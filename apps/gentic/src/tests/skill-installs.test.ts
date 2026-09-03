import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"

import type {
  ReportHostSkillInstallResultInput,
  HostSkillInstallCommand,
} from "@gentic/validators/skills"

import type { AgentApi } from "../api.js"
import {
  buildSkillInstallArgs,
  createSkillInstallRunner,
  runSkillInstall,
  skillInstallEnv,
  type SpawnProcess,
} from "../skill-installs.js"

const command: HostSkillInstallCommand = {
  id: "55555555-5555-4555-8555-555555555555",
  source: "anthropics/skills",
  skill: "pdf",
  expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
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

function fakeSpawn(handle: (child: FakeChild) => void): {
  spawnProcess: SpawnProcess
  calls: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }>
} {
  const calls: Array<{
    command: string
    args: string[]
    env: NodeJS.ProcessEnv
  }> = []

  const spawnProcess = ((
    spawned: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv }
  ) => {
    calls.push({ command: spawned, args, env: options.env })
    const child = new FakeChild()
    setImmediate(() => handle(child))
    return child
  }) as unknown as SpawnProcess

  return { spawnProcess, calls }
}

test("builds the exact global, both-agent, non-interactive CLI invocation", () => {
  assert.deepEqual(buildSkillInstallArgs(command), [
    "-y",
    "skills@latest",
    "add",
    "anthropics/skills",
    "--skill",
    "pdf",
    "--global",
    "--agent",
    "claude-code",
    "--agent",
    "codex",
    "--yes",
  ])
  assert.equal(skillInstallEnv({ PATH: "/usr/bin" }).DISABLE_TELEMETRY, "1")
  assert.ok(!buildSkillInstallArgs(command).includes("--copy"))
})

test("a clean exit reports success without echoing the CLI output", async () => {
  const { spawnProcess, calls } = fakeSpawn((child) => {
    child.stdout.emit("data", Buffer.from("installed to /home/ada/.claude"))
    child.emit("close", 0)
  })

  const result = await runSkillInstall(command, { spawnProcess })

  assert.deepEqual(result, {
    status: "installed",
    error_summary: null,
    output: null,
  })
  assert.equal(calls[0].command, "npx")
  assert.equal(calls[0].env.DISABLE_TELEMETRY, "1")
})

test("a non-zero exit reports the failure with its captured output", async () => {
  const { spawnProcess } = fakeSpawn((child) => {
    child.stderr.emit("data", Buffer.from("npm error 404 Not Found"))
    child.emit("close", 1)
  })

  const result = await runSkillInstall(command, { spawnProcess })

  assert.equal(result.status, "failed")
  assert.equal(result.error_summary, "npx skills add exited with code 1.")
  assert.match(result.output ?? "", /npm error 404 Not Found/)
})

test("a missing npx is an ordinary install failure", async () => {
  const { spawnProcess } = fakeSpawn((child) => {
    const error: NodeJS.ErrnoException = new Error("spawn npx ENOENT")
    error.code = "ENOENT"
    child.emit("error", error)
  })

  const result = await runSkillInstall(command, { spawnProcess })

  assert.equal(result.status, "failed")
  assert.equal(result.error_summary, "npx is not available on this host.")
})

test("an install still running at expiry is killed and reported", async () => {
  const started: FakeChild[] = []
  const { spawnProcess } = fakeSpawn((child) => {
    started.push(child)
  })

  const result = await runSkillInstall(
    { ...command, expires_at: new Date(Date.now() - 60_000).toISOString() },
    { spawnProcess }
  )

  assert.equal(result.status, "failed")
  assert.match(result.error_summary ?? "", /did not finish before/)
  assert.equal(started[0]?.killed, true)
})

test("the runner claims one command at a time and sanitizes what it reports", async () => {
  const claimed: HostSkillInstallCommand[] = []
  const reported: Array<{
    installId: string
    result: ReportHostSkillInstallResultInput
  }> = []
  let pending: HostSkillInstallCommand | null = command
  const finishRun: { release: () => void } = { release: () => {} }

  const api = {
    async claimSkillInstall() {
      const next = pending
      pending = null
      if (next) claimed.push(next)
      return next
    },
    async reportSkillInstall(
      installId: string,
      result: ReportHostSkillInstallResultInput
    ) {
      reported.push({ installId, result })
    },
  } as unknown as AgentApi

  const runner = createSkillInstallRunner(api, {
    run: async () =>
      new Promise((resolve) => {
        finishRun.release = () =>
          resolve({
            status: "failed",
            error_summary: "npx skills add exited with code 1.",
            output: "npm error path /home/ada/.claude",
          })
      }),
  })

  await runner.poll()
  // A second tick while the first install is still running must not claim
  // again: only one install may be in flight per host.
  pending = { ...command, id: "second" }
  await runner.poll()
  assert.deepEqual(
    claimed.map((entry) => entry.id),
    [command.id]
  )

  finishRun.release()
  await runner.drain()

  assert.equal(reported.length, 1)
  assert.equal(reported[0].installId, command.id)
  assert.equal(reported[0].result.output, "npm error path ~/.claude")
})

test("a failed claim leaves the runner ready to try again", async () => {
  let attempts = 0
  const api = {
    async claimSkillInstall() {
      attempts += 1
      throw new Error("control channel unavailable")
    },
    async reportSkillInstall() {},
  } as unknown as AgentApi

  const runner = createSkillInstallRunner(api, {
    run: async () => ({ status: "installed" }),
  })

  await runner.poll()
  await runner.poll()

  assert.equal(attempts, 2)
})
