import { spawn } from "node:child_process"

/** Status of one external CLI gentic depends on for running issues. */
export interface ToolStatus {
  installed: boolean
  authenticated: boolean
}

export interface ToolStatuses {
  github: ToolStatus
  claude: ToolStatus
  codex: ToolStatus
}

const COMMAND_TIMEOUT_MS = 10_000

interface CommandResult {
  code: number | null
  stdout: string
  missing: boolean
}

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

async function checkGithub(): Promise<ToolStatus> {
  const version = await runCommand("gh", ["--version"])
  if (version.missing) return { installed: false, authenticated: false }

  const auth = await runCommand("gh", ["auth", "status"])
  return { installed: true, authenticated: auth.code === 0 }
}

async function checkClaude(): Promise<ToolStatus> {
  const version = await runCommand("claude", ["--version"])
  if (version.missing) return { installed: false, authenticated: false }

  const auth = await runCommand("claude", ["auth", "status", "--json"])
  if (auth.code !== 0) return { installed: true, authenticated: false }
  try {
    const parsed = JSON.parse(auth.stdout) as { loggedIn?: boolean }
    return { installed: true, authenticated: parsed.loggedIn === true }
  } catch {
    return { installed: true, authenticated: false }
  }
}

async function checkCodex(): Promise<ToolStatus> {
  const version = await runCommand("codex", ["--version"])
  if (version.missing) return { installed: false, authenticated: false }

  const auth = await runCommand("codex", ["login", "status"])
  return { installed: true, authenticated: auth.code === 0 }
}

/**
 * Checks the CLIs gentic shells out to for running issues: `gh` (used by
 * every agent to open the closing PR), `claude` (claude_code issues), and
 * `codex` (codex issues). Each check is a local, fast subprocess call — no
 * gentic-specific auth is required to run it.
 */
export async function getToolStatuses(): Promise<ToolStatuses> {
  const [github, claude, codex] = await Promise.all([
    checkGithub(),
    checkClaude(),
    checkCodex(),
  ])
  return { github, claude, codex }
}

export function formatToolStatus(status: ToolStatus): string {
  if (!status.installed) return "not installed"
  return status.authenticated
    ? "installed, authenticated"
    : "installed, not authenticated"
}
