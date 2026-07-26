import { spawn } from "node:child_process"

/** Status of one external CLI gentic depends on for running issues. */
export interface ToolStatus {
  installed: boolean
  authenticated: boolean
  /** Version reported by the CLI, or null if not installed/unparseable. */
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

type RunCommand = (command: string, args: string[]) => Promise<CommandResult>

function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] })
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

async function checkClaude(run: RunCommand = runCommand): Promise<ToolStatus> {
  const versionResult = await run("claude", ["--version"])
  if (versionResult.missing) {
    return { installed: false, authenticated: false, version: null }
  }
  const version = parseVersion(/^(\S+)/, versionResult.stdout)

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
