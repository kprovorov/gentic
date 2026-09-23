import { spawn } from "node:child_process"

import { claudeCliCommand } from "./session.js"

/** Status of one external CLI gentic depends on for running issues. */
export interface ToolStatus {
  installed: boolean
  authenticated: boolean
  /**
   * Version of the CLI that actually runs issues, or null if not
   * installed/unparseable. For Claude Code that is the binary bundled with
   * gentic, which is *not* the `claude` on PATH — see `checkClaude`.
   */
  version: string | null
}

export interface ToolStatuses {
  github: ToolStatus
  claude?: ToolStatus
  codex?: ToolStatus
}

const COMMAND_TIMEOUT_MS = 10_000

interface CommandResult {
  code: number | null
  stdout: string
  missing: boolean
}

type RunCommand = (
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv
) => Promise<CommandResult>

function runCommand(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "ignore"],
      ...(env ? { env: { ...process.env, ...env } } : {}),
    })
    let stdout = ""
    let settled = false

    const finish = (result: CommandResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill()
      finish({ code: null, stdout, missing: false })
    }, COMMAND_TIMEOUT_MS)

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })
    child.on("error", (error) => {
      const missing = (error as NodeJS.ErrnoException).code === "ENOENT"
      finish({ code: null, stdout, missing })
    })
    child.on("close", (code) => {
      finish({ code, stdout, missing: false })
    })
  })
}

function parseVersion(pattern: RegExp, output: string): string | null {
  return pattern.exec(output)?.[1] ?? null
}

export async function checkGithub(
  run: RunCommand = runCommand
): Promise<ToolStatus> {
  const versionResult = await run("gh", ["--version"])
  if (versionResult.missing) {
    return { installed: false, authenticated: false, version: null }
  }
  const version = parseVersion(/gh version (\S+)/, versionResult.stdout)

  const auth = await run("gh", ["auth", "status"])
  return { installed: true, authenticated: auth.code === 0, version }
}

/**
 * Version of the Claude Code that actually serves sessions — the copy bundled
 * with gentic, not the `claude` on PATH. Reporting the PATH one is actively
 * misleading: the two drift apart constantly, and a host that fixes an
 * unsupported-model error by running `claude update` moves only the PATH copy
 * while the pinned bundled binary keeps failing. Returns null rather than
 * throwing, so a resolution failure costs the version readout and not the
 * whole status.
 */
async function bundledClaudeVersion(run: RunCommand): Promise<string | null> {
  try {
    const probe = claudeCliCommand(["--version"])
    const result = await run(probe.command, probe.args, probe.env)
    if (result.missing) return null
    return parseVersion(/^(\S+)/, result.stdout)
  } catch {
    return null
  }
}

/**
 * `installed`/`authenticated` describe the `claude` CLI on PATH, which is what
 * onboarding installs and logs in; `version` describes the bundled binary that
 * runs issues. They are deliberately different binaries — see
 * `bundledClaudeVersion` and `claudeCliCommand`. The two share ~/.claude, so
 * the PATH CLI's login state is a valid read on the bundled one's.
 */
async function checkClaude(run: RunCommand = runCommand): Promise<ToolStatus> {
  const versionResult = await run("claude", ["--version"])
  if (versionResult.missing) {
    return { installed: false, authenticated: false, version: null }
  }
  const version = await bundledClaudeVersion(run)

  const auth = await run("claude", ["auth", "status", "--json"])
  if (auth.code !== 0) return { installed: true, authenticated: false, version }
  try {
    const parsed = JSON.parse(auth.stdout) as { loggedIn?: boolean }
    return {
      installed: true,
      authenticated: parsed.loggedIn === true,
      version,
    }
  } catch {
    return { installed: true, authenticated: false, version }
  }
}

async function checkCodex(run: RunCommand = runCommand): Promise<ToolStatus> {
  const versionResult = await run("codex", ["--version"])
  if (versionResult.missing) {
    return { installed: false, authenticated: false, version: null }
  }
  const version = parseVersion(/codex-cli (\S+)/, versionResult.stdout)

  const auth = await run("codex", ["login", "status"])
  return { installed: true, authenticated: auth.code === 0, version }
}

/**
 * Checks the CLIs gentic shells out to for running issues: `gh` (used by
 * every agent to open the closing PR), `claude` (claude_code issues), and
 * `codex` (codex issues). Each check is a local, fast subprocess call — no
 * gentic-specific auth is required to run it.
 */
export async function getToolStatuses(
  run: RunCommand = runCommand
): Promise<ToolStatuses> {
  const [github, claude, codex] = await Promise.all([
    checkGithub(run),
    checkClaude(run),
    checkCodex(run),
  ])
  return { github, claude, codex }
}

export function formatToolStatus(status: ToolStatus): string {
  if (!status.installed) return "not installed"
  return status.authenticated
    ? "installed, authenticated"
    : "installed, not authenticated"
}
