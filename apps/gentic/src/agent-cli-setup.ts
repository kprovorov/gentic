import type { AgentProvider } from "./agents.js"
import { detectPlatform, spawnInteractive } from "./installers.js"
import type { ToolStatus, ToolStatuses } from "./tools.js"
import { cancel, confirm, isCancel, log } from "./ui.js"

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

export async function setupSelectedAgentCLIs(
  agentProviders: AgentProvider[],
  tools: ToolStatuses,
  deps: AgentCliSetupDeps = defaultDeps
): Promise<boolean> {
  if (!agentProviders.includes("codex") || !tools.codex) return true

  return setupCodex(tools.codex, deps)
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
