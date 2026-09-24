import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

import {
  sanitizeHostToolUpdateOutput,
  type HostTool,
  type HostToolUpdateCommand,
  type ReportHostToolUpdateResultInput,
} from "@gentic/validators/host-tool-updates"

import packageJson from "../package.json" with { type: "json" }
import type { AgentApi } from "./api.js"
import {
  detectHomebrew,
  detectLinuxPackageManager,
  type LinuxPackageManager,
} from "./installers.js"
import { logError, logInfo } from "./log.js"

/** Bounds how much CLI chatter is held in memory before it is sanitized. */
const OUTPUT_CAPTURE_LIMIT = 64 * 1024

/** A version probe is a quick local call; it never waits on the network. */
const PROBE_TIMEOUT_MS = 10_000

export type SpawnProcess = typeof spawn

/**
 * How the running gentic got onto this machine. Only the package-manager
 * channels can be updated in place from here; the standalone binary and a
 * source checkout are updated by the operator, so those report as such.
 */
export type GenticInstallChannel = "npm" | "pnpm" | "bun" | "binary" | "source"

export interface UpdateEnvironment {
  platform: NodeJS.Platform
  packageManager: LinuxPackageManager | null
  homebrew: boolean
  /** Root skips `sudo`; anyone else needs passwordless sudo for system packages. */
  root: boolean
  genticInstall: GenticInstallChannel
  /** The version this process is running, to tell a real gentic update apart. */
  genticVersion: string
}

export interface UpdateStep {
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
}

export interface VersionProbe {
  command: string
  args: string[]
  pattern: RegExp
}

export type UpdatePlan =
  | { supported: true; steps: UpdateStep[]; probe: VersionProbe }
  | { supported: false; reason: string }

export const toolLabels: Record<HostTool, string> = {
  gentic: "Gentic",
  claude_code: "Claude Code",
  codex: "Codex",
  github: "GitHub CLI",
}

const versionProbes: Record<HostTool, VersionProbe> = {
  gentic: { command: "gentic", args: ["--version"], pattern: /^(\S+)/ },
  claude_code: { command: "claude", args: ["--version"], pattern: /^(\S+)/ },
  codex: { command: "codex", args: ["--version"], pattern: /codex-cli (\S+)/ },
  github: { command: "gh", args: ["--version"], pattern: /gh version (\S+)/ },
}

const brewEnv = { HOMEBREW_NO_ENV_HINTS: "1", NONINTERACTIVE: "1" }

/**
 * Where this gentic came from, read off the module's own path. An npm-style
 * global install lands the bundle under `node_modules/gentic-cli`, pnpm and
 * bun keep their globals under distinctive roots, a Bun-compiled binary runs
 * from its virtual `/$bunfs/` filesystem, and anything else is a checkout.
 */
export function detectGenticInstallChannel(
  runtime: { argv: string[]; entryPath: string } = {
    argv: process.argv,
    entryPath: fileURLToPath(import.meta.url),
  }
): GenticInstallChannel {
  if (runtime.argv[1]?.startsWith("/$bunfs/")) return "binary"

  const entry = runtime.entryPath.replaceAll("\\", "/")
  if (entry.includes("/.bun/install/global/")) return "bun"
  if (entry.includes("/pnpm/global/")) return "pnpm"
  if (entry.includes("/node_modules/gentic-cli/")) return "npm"
  return "source"
}

export function detectUpdateEnvironment(): UpdateEnvironment {
  return {
    platform: process.platform,
    packageManager: detectLinuxPackageManager(),
    homebrew: detectHomebrew(),
    root: process.getuid?.() === 0,
    genticInstall: detectGenticInstallChannel(),
    genticVersion: packageJson.version,
  }
}

/**
 * The exact, non-interactive invocation that updates one tool on this host.
 * Each tool is updated the way onboarding installed it, so the update lands
 * on the same copy the host has been running: `claude update` for Claude
 * Code, Homebrew on macOS and the system package manager on Linux for `gh`,
 * Homebrew or npm for Codex, and the package manager that installed gentic
 * for gentic itself. Nothing here is a shell string.
 */
export function buildToolUpdatePlan(
  tool: HostTool,
  env: UpdateEnvironment
): UpdatePlan {
  const probe = versionProbes[tool]

  switch (tool) {
    case "claude_code":
      return {
        supported: true,
        steps: [{ command: "claude", args: ["update"] }],
        probe,
      }

    case "codex":
      if (env.platform === "darwin" && env.homebrew) {
        return {
          supported: true,
          steps: [
            { command: "brew", args: ["upgrade", "codex"], env: brewEnv },
          ],
          probe,
        }
      }
      return {
        supported: true,
        steps: [
          { command: "npm", args: ["install", "-g", "@openai/codex@latest"] },
        ],
        probe,
      }

    case "github":
      return githubPlan(env, probe)

    case "gentic":
      return genticPlan(env, probe)
  }
}

function githubPlan(env: UpdateEnvironment, probe: VersionProbe): UpdatePlan {
  if (env.platform === "darwin") {
    if (!env.homebrew) {
      return {
        supported: false,
        reason:
          "Homebrew was not found on this host, so gh cannot be upgraded automatically. Update GitHub CLI by hand.",
      }
    }
    return {
      supported: true,
      steps: [{ command: "brew", args: ["upgrade", "gh"], env: brewEnv }],
      probe,
    }
  }

  if (env.platform !== "linux") {
    return {
      supported: false,
      reason: `Updating GitHub CLI is not supported on ${env.platform}.`,
    }
  }

  switch (env.packageManager) {
    case "apt-get": {
      const aptEnv = { DEBIAN_FRONTEND: "noninteractive" }
      return {
        supported: true,
        steps: [
          privileged(env, {
            command: "apt-get",
            args: ["update"],
            env: aptEnv,
          }),
          privileged(env, {
            command: "apt-get",
            args: ["install", "-y", "--only-upgrade", "gh"],
            env: aptEnv,
          }),
        ],
        probe,
      }
    }
    case "dnf":
      return {
        supported: true,
        steps: [
          privileged(env, { command: "dnf", args: ["upgrade", "-y", "gh"] }),
        ],
        probe,
      }
    case "pacman":
      return {
        supported: true,
        steps: [
          privileged(env, {
            command: "pacman",
            args: ["-Sy", "--noconfirm", "--needed", "gh"],
          }),
        ],
        probe,
      }
    default:
      return {
        supported: false,
        reason:
          "No supported Linux package manager (apt-get, dnf or pacman) was found on this host. Update GitHub CLI by hand.",
      }
  }
}

function genticPlan(env: UpdateEnvironment, probe: VersionProbe): UpdatePlan {
  switch (env.genticInstall) {
    case "npm":
      return {
        supported: true,
        steps: [
          { command: "npm", args: ["install", "-g", "gentic-cli@latest"] },
        ],
        probe,
      }
    case "pnpm":
      return {
        supported: true,
        steps: [{ command: "pnpm", args: ["add", "-g", "gentic-cli@latest"] }],
        probe,
      }
    case "bun":
      return {
        supported: true,
        steps: [{ command: "bun", args: ["add", "-g", "gentic-cli@latest"] }],
        probe,
      }
    case "binary":
      return {
        supported: false,
        reason:
          "This host runs the standalone gentic binary. Install the latest release package or tarball to update it.",
      }
    case "source":
      return {
        supported: false,
        reason:
          "This host runs gentic from a source checkout. Pull the latest changes and rebuild to update it.",
      }
  }
}

/** System package managers need root; `-n` fails fast instead of prompting. */
function privileged(env: UpdateEnvironment, step: UpdateStep): UpdateStep {
  if (env.root) return step
  return { ...step, command: "sudo", args: ["-n", step.command, ...step.args] }
}

export type ToolUpdateOutcome = {
  report: ReportHostToolUpdateResultInput
  /** Only ever true for a gentic update that installed a different version. */
  restartRequired: boolean
}

interface StepResult {
  code: number | null
  output: string
  missing: boolean
  timedOut: boolean
}

/**
 * Runs one update to completion. Every ending — success, a non-zero exit, a
 * missing executable, a hang past the command's expiry — resolves to a
 * result the host reports; updates are attempted once and never retried.
 */
export async function runToolUpdate(
  command: HostToolUpdateCommand,
  deps: {
    spawnProcess?: SpawnProcess
    environment?: UpdateEnvironment
    processEnv?: NodeJS.ProcessEnv
    now?: () => Date
  } = {}
): Promise<ToolUpdateOutcome> {
  const spawnProcess = deps.spawnProcess ?? spawn
  const now = deps.now ?? (() => new Date())
  const environment = deps.environment ?? detectUpdateEnvironment()
  const plan = buildToolUpdatePlan(command.tool, environment)
  const label = toolLabels[command.tool]

  if (!plan.supported) {
    return { report: failure(plan.reason, ""), restartRequired: false }
  }

  const run = (step: UpdateStep, timeoutMs: number) =>
    runStep(step, { spawnProcess, processEnv: deps.processEnv, timeoutMs })
  const probe = async () => {
    const result = await run(plan.probe, PROBE_TIMEOUT_MS)
    return result.code === 0
      ? (plan.probe.pattern.exec(result.output)?.[1] ?? null)
      : null
  }

  const before = await probe()

  for (const step of plan.steps) {
    const remainingMs = Date.parse(command.expires_at) - now().getTime()
    const result = await run(step, Math.max(1_000, remainingMs))
    const display = `${step.command} ${step.args.join(" ")}`

    if (result.missing) {
      return {
        report: failure(
          `${step.command} is not available on this host.`,
          result.output
        ),
        restartRequired: false,
      }
    }
    if (result.timedOut) {
      return {
        report: failure(
          "The update did not finish before the command expired.",
          result.output
        ),
        restartRequired: false,
      }
    }
    if (result.code !== 0) {
      return {
        report: failure(
          `${display} exited with code ${result.code}.`,
          result.output
        ),
        restartRequired: false,
      }
    }
  }

  const after = await probe()

  if (command.tool === "gentic") {
    const restartRequired =
      after !== null && after !== environment.genticVersion
    return {
      report: {
        status: "updated",
        summary: restartRequired
          ? `Installed ${after}. The host restarts once its active tasks finish.`
          : after
            ? `Already up to date (${after}).`
            : `${label} update finished, but the installed version could not be determined.`,
        output: null,
        version: after,
      },
      restartRequired,
    }
  }

  return {
    report: {
      status: "updated",
      summary:
        after && before && after !== before
          ? `Updated from ${before} to ${after}.`
          : after && before === after
            ? `Already up to date (${after}).`
            : after
              ? `Updated to ${after}.`
              : `${label} update finished, but the installed version could not be determined.`,
      output: null,
      version: after,
    },
    restartRequired: false,
  }
}

function runStep(
  step: UpdateStep,
  deps: {
    spawnProcess: SpawnProcess
    processEnv?: NodeJS.ProcessEnv
    timeoutMs: number
  }
): Promise<StepResult> {
  return new Promise((resolve) => {
    const child = deps.spawnProcess(step.command, step.args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...(deps.processEnv ?? process.env), ...step.env },
    })

    let output = ""
    let settled = false

    const capture = (chunk: Buffer) => {
      if (output.length >= OUTPUT_CAPTURE_LIMIT) return
      output += chunk.toString("utf8")
    }

    const finish = (result: StepResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill()
      finish({ code: null, output, missing: false, timedOut: true })
    }, deps.timeoutMs)

    child.stdout?.on("data", capture)
    child.stderr?.on("data", capture)

    child.on("error", (error: NodeJS.ErrnoException) => {
      finish({
        code: null,
        output:
          error.code === "ENOENT" ? output : `${output}\n${error.message}`,
        missing: error.code === "ENOENT",
        timedOut: false,
      })
    })

    child.on("close", (code) => {
      finish({ code, output, missing: false, timedOut: false })
    })
  })
}

export type ToolUpdateRunner = {
  /** Claims and starts at most one update; returns as soon as it is started. */
  poll: () => Promise<void>
  /** Resolves once any in-flight update has reported its result. */
  drain: () => Promise<void>
}

export type ToolUpdatedEvent = {
  tool: HostTool
  restartRequired: boolean
}

/**
 * Polls the same outbound channel the host already uses for control. An
 * update runs alongside issue work: it never claims a run slot or interrupts
 * an active session. The server hands out one command per host at a time;
 * `onUpdated` fires after a successful update has been reported, so the loop
 * can refresh what it tells the server about its tools and, for a gentic
 * update, arrange to restart.
 */
export function createToolUpdateRunner(
  api: AgentApi,
  deps: {
    run?: typeof runToolUpdate
    spawnProcess?: SpawnProcess
    onUpdated?: (event: ToolUpdatedEvent) => Promise<void> | void
  } = {}
): ToolUpdateRunner {
  const run = deps.run ?? runToolUpdate
  let active: Promise<void> | null = null

  return {
    async poll() {
      if (active) {
        return
      }

      let command: HostToolUpdateCommand | null
      try {
        command = await api.claimToolUpdate()
      } catch (error) {
        logError("tool update check failed:", describe(error))
        return
      }

      if (!command) {
        return
      }

      const label = toolLabels[command.tool]
      logInfo(`updating ${label}`)
      active = run(command, { spawnProcess: deps.spawnProcess })
        .then(async (outcome) => {
          await api.reportToolUpdate(command.id, sanitizeReport(outcome.report))
          logInfo(
            `${label} update ${outcome.report.status === "updated" ? "finished" : "failed"}: ${outcome.report.summary ?? ""}`
          )
          if (outcome.report.status === "updated") {
            await deps.onUpdated?.({
              tool: command.tool,
              restartRequired: outcome.restartRequired,
            })
          }
        })
        .catch((error) => {
          logError("failed to report tool update result:", describe(error))
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
): ReportHostToolUpdateResultInput {
  return { status: "failed", summary, output, version: null }
}

function sanitizeReport(
  report: ReportHostToolUpdateResultInput
): ReportHostToolUpdateResultInput {
  const output = report.output
    ? sanitizeHostToolUpdateOutput(report.output)
    : null
  return {
    status: report.status,
    summary: report.summary
      ? sanitizeHostToolUpdateOutput(report.summary).slice(0, 500)
      : null,
    output: output && output.length > 0 ? output : null,
    version: report.version ?? null,
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
