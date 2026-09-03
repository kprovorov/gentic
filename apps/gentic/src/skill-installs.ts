import { spawn } from "node:child_process"

import {
  sanitizeSkillInstallOutput,
  type ReportHostSkillInstallResultInput,
  type HostSkillInstallCommand,
} from "@gentic/validators/skills"

import type { AgentApi } from "./api.js"
import { logError, logInfo } from "./log.js"

/** Both managed providers get the skill; the CLI owns the filesystem layout. */
export const SKILL_INSTALL_AGENTS = ["claude-code", "codex"] as const

/** Bounds how much CLI chatter is held in memory before it is sanitized. */
const OUTPUT_CAPTURE_LIMIT = 64 * 1024

export type SpawnProcess = typeof spawn

/**
 * The exact invocation the issue specifies, built from the command's validated
 * `source` and `skill` fields. Nothing here is a shell string and the submitted
 * skills.sh URL is never an argument, so a hostile URL cannot reach the CLI.
 */
export function buildSkillInstallArgs(
  command: Pick<HostSkillInstallCommand, "source" | "skill">
): string[] {
  return [
    "-y",
    "skills@latest",
    "add",
    command.source,
    "--skill",
    command.skill,
    "--global",
    ...SKILL_INSTALL_AGENTS.flatMap((agent) => ["--agent", agent]),
    "--yes",
  ]
}

export function skillInstallEnv(
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  return { ...env, DISABLE_TELEMETRY: "1" }
}

/**
 * Runs one install to completion. Every ending — success, a non-zero exit, a
 * missing `npx`, a hang past the command's expiry — resolves to a result the
 * host reports; installs are attempted once and never retried.
 */
export function runSkillInstall(
  command: HostSkillInstallCommand,
  deps: {
    spawnProcess?: SpawnProcess
    env?: NodeJS.ProcessEnv
    now?: () => Date
  } = {}
): Promise<ReportHostSkillInstallResultInput> {
  const spawnProcess = deps.spawnProcess ?? spawn
  const now = deps.now ?? (() => new Date())
  const args = buildSkillInstallArgs(command)

  return new Promise((resolve) => {
    const child = spawnProcess("npx", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: skillInstallEnv(deps.env),
    })

    let captured = ""
    let settled = false

    const capture = (chunk: Buffer) => {
      if (captured.length >= OUTPUT_CAPTURE_LIMIT) return
      captured += chunk.toString("utf8")
    }

    const finish = (result: ReportHostSkillInstallResultInput) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const remainingMs = Math.max(
      1_000,
      Date.parse(command.expires_at) - now().getTime()
    )
    const timer = setTimeout(() => {
      child.kill()
      finish(
        failure("The install did not finish before the command expired.", captured)
      )
    }, remainingMs)

    child.stdout?.on("data", capture)
    child.stderr?.on("data", capture)

    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(
        failure(
          error.code === "ENOENT"
            ? "npx is not available on this host."
            : `Could not start the skills CLI: ${error.message}`,
          captured
        )
      )
    })

    child.on("close", (code) => {
      if (code === 0) {
        // Nothing useful to show for a success, and the output can name local
        // paths, so only failures carry it back.
        finish({ status: "installed", error_summary: null, output: null })
        return
      }
      finish(failure(`npx skills add exited with code ${code}.`, captured))
    })
  })
}

export type SkillInstallRunner = {
  /** Claims and starts at most one install; returns as soon as it is started. */
  poll: () => Promise<void>
  /** Resolves once any in-flight install has reported its result. */
  drain: () => Promise<void>
}

/**
 * Polls the same outbound channel the host already uses for control. An
 * install runs alongside issue work: it never claims a run slot, pauses issue
 * claiming, or interrupts an active session.
 */
export function createSkillInstallRunner(
  api: AgentApi,
  deps: {
    run?: typeof runSkillInstall
    spawnProcess?: SpawnProcess
  } = {}
): SkillInstallRunner {
  const run = deps.run ?? runSkillInstall
  let active: Promise<void> | null = null

  return {
    async poll() {
      if (active) {
        return
      }

      let command: HostSkillInstallCommand | null
      try {
        command = await api.claimSkillInstall()
      } catch (error) {
        logError("skill install check failed:", describe(error))
        return
      }

      if (!command) {
        return
      }

      logInfo(`installing skill ${command.source}/${command.skill}`)
      active = run(command, { spawnProcess: deps.spawnProcess })
        .then(async (result) => {
          await api.reportSkillInstall(command.id, sanitizeResult(result))
          logInfo(
            `skill ${command.source}/${command.skill} ${
              result.status === "installed" ? "installed" : "failed"
            }`
          )
        })
        .catch((error) => {
          logError("failed to report skill install result:", describe(error))
        })
        .finally(() => {
          active = null
        })
    },
    async drain() {
      await active
    },
  }
}

function failure(
  summary: string,
  output: string
): ReportHostSkillInstallResultInput {
  return { status: "failed", error_summary: summary, output }
}

function sanitizeResult(
  result: ReportHostSkillInstallResultInput
): ReportHostSkillInstallResultInput {
  return {
    status: result.status,
    error_summary: result.error_summary
      ? sanitizeSkillInstallOutput(result.error_summary).slice(0, 500)
      : null,
    output: result.output ? sanitizeSkillInstallOutput(result.output) : null,
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
