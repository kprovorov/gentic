import { detectPlatform, spawnInteractive } from "./installers.js"
import type { ToolStatus, ToolStatuses } from "./tools.js"
import { cancel, confirm, isCancel, log } from "./ui.js"

const CLAUDE_INSTALL_COMMAND = "curl -fsSL https://claude.ai/install.sh | bash"

interface ConfirmOptions {
  message: string
}

type ConfirmResult = boolean | symbol

export interface AgentCliSetupDeps {
  confirm: (options: ConfirmOptions) => Promise<ConfirmResult>
  isCancel: (value: unknown) => boolean
  cancel: (message?: string) => void
  log: Pick<typeof log, "info" | "warn" | "success">
  detectPlatform: typeof detectPlatform
  spawnInteractive: typeof spawnInteractive
}

const defaultDeps: AgentCliSetupDeps = {
  confirm,
  isCancel,
  cancel,
  log,
  detectPlatform,
  spawnInteractive,
}

export async function setupAgentCLIs(
  tools: ToolStatuses,
  deps: AgentCliSetupDeps = defaultDeps
): Promise<boolean> {
  if (tools.claude) {
    const completedClaudeSetup = await setupClaudeCode(tools.claude, deps)
    if (!completedClaudeSetup) return false
  }

  if (!tools.codex) return true

  return setupCodex(tools.codex, deps)
}

async function setupClaudeCode(
  status: ToolStatus,
  deps: AgentCliSetupDeps
): Promise<boolean> {
  if (status.installed && status.authenticated) return true

  if (!status.installed) {
    const installCommand = claudeInstallCommand(deps)
    if (!installCommand) return true

    const confirmed = await deps.confirm({
      message: `Claude Code is not installed. Run \`${CLAUDE_INSTALL_COMMAND}\` now?`,
    })
    if (deps.isCancel(confirmed)) {
      deps.cancel("Cancelled.")
      return false
    }
    if (!confirmed) return true

    try {
      await deps.spawnInteractive(installCommand.command, installCommand.args)
    } catch (error) {
      deps.log.warn(`Claude Code install did not complete: ${describe(error)}`)
      return true
    }
  }

  const loginConfirmed = await deps.confirm({
    message: "Claude Code is not authenticated. Run `claude auth login` now?",
  })
  if (deps.isCancel(loginConfirmed)) {
    deps.cancel("Cancelled.")
    return false
  }
  if (!loginConfirmed) return true

  try {
    await deps.spawnInteractive("claude", ["auth", "login"])
    deps.log.success("Claude Code authenticated.")
  } catch (error) {
    deps.log.warn(`Claude Code authentication did not complete: ${describe(error)}`)
  }
  return true
}

async function setupCodex(
  status: ToolStatus,
  deps: AgentCliSetupDeps
): Promise<boolean> {
  if (status.installed && status.authenticated) return true

  if (!status.installed) {
    const installCommand = codexInstallCommand(deps)
    if (!installCommand) return true

    const confirmed = await deps.confirm({
      message: `Codex CLI is not installed. Run \`${installCommand.command} ${installCommand.args.join(" ")}\` now?`,
    })
    if (deps.isCancel(confirmed)) {
      deps.cancel("Cancelled.")
      return false
    }
    if (!confirmed) return true

    await deps.spawnInteractive(installCommand.command, installCommand.args)
  }

  const loginConfirmed = await deps.confirm({
    message: "Codex CLI is not authenticated. Run `codex login` now?",
  })
  if (deps.isCancel(loginConfirmed)) {
    deps.cancel("Cancelled.")
    return false
  }
  if (!loginConfirmed) return true

  await deps.spawnInteractive("codex", ["login"])
  deps.log.success("Codex CLI authenticated.")
  return true
}

function claudeInstallCommand(
  deps: AgentCliSetupDeps
): { command: string; args: string[] } | null {
  deps.detectPlatform()
  return { command: "bash", args: ["-lc", CLAUDE_INSTALL_COMMAND] }
}

function codexInstallCommand(
  deps: AgentCliSetupDeps
): { command: string; args: string[] } | null {
  const platform = deps.detectPlatform()
  if (platform === "darwin") {
    return { command: "brew", args: ["install", "codex"] }
  }
  if (platform === "linux") {
    return { command: "npm", args: ["install", "-g", "@openai/codex"] }
  }

  deps.log.warn(`Codex CLI setup is not supported on ${platform}.`)
  return null
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
