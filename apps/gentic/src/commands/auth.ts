import type { Command } from "commander"

import { agentProviders, formatAgentProviders } from "../agents.js"
import { getConfigInput } from "../config.js"
import {
  writeConfigFile,
} from "../config-store.js"
import { logError } from "../log.js"
import {
  cancel,
  confirm,
  isCancel,
  log,
} from "../ui.js"

export interface AuthState {
  authenticated: boolean
  hostId?: string
  apiUrl?: string
  maskedHostCredential?: string
  setupState?: "setup-incomplete" | "ready"
}

/** Reused by any future `gentic status` dashboard that wants auth info. */
export function getAuthState(): AuthState {
  const config = getConfigInput()
  if (
    !config.GENTIC_HOST_ID ||
    !config.GENTIC_HOST_CREDENTIAL ||
    !config.GENTIC_API_URL
  ) {
    return { authenticated: false }
  }
  return {
    authenticated: true,
    hostId: config.GENTIC_HOST_ID,
    apiUrl: config.GENTIC_API_URL,
    maskedHostCredential: maskHostCredential(
      config.GENTIC_HOST_CREDENTIAL
    ),
    setupState: config.GENTIC_HOST_SETUP_STATE ?? "ready",
  }
}

function maskHostCredential(credential: string): string {
  const suffix = credential.slice(-4)
  return `${credential.slice(0, 3)}...${suffix}`
}

export function registerAuthCommand(program: Command): void {
  const auth = program
    .command("auth")
    .description("Manage Gentic API credentials")

  auth
    .command("login")
    .description("Deprecated: connect a Gentic host instead")
    .action(() => {
      logError(
        "auth login has been replaced. Generate a host code in Gentic, then run `gentic host connect <code>`."
      )
      process.exitCode = 1
    })

  auth
    .command("logout")
    .description("Clear stored Gentic API credentials")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(async (opts: { yes?: boolean }) => {
      await logout(opts)
    })

  auth
    .command("status")
    .description("Show whether the Gentic CLI is authenticated")
    .action(() => {
      status()
    })
}

export async function loginInteractive(): Promise<void> {
  logError(
    "auth login has been replaced. Generate a host code in Gentic, then run `gentic host connect <code>`."
  )
  process.exitCode = 1
}

async function logout(opts: { yes?: boolean }): Promise<void> {
  if (!opts.yes) {
    const confirmed = await confirm({
      message: "Clear stored Gentic API credentials?",
    })
    if (isCancel(confirmed) || !confirmed) {
      cancel("Cancelled.")
      return
    }
  }

  // Clears only the auth keys, not the whole config file, so unrelated
  // settings (GIT_REMOTE_BASE, WORKDIR, POLL_INTERVAL_MS) survive a logout.
  writeConfigFile({
    GENTIC_HOST_ID: undefined,
    GENTIC_HOST_CREDENTIAL: undefined,
    GENTIC_API_URL: undefined,
    GENTIC_HOST_SETUP_STATE: undefined,
  })
  log.success("Cleared stored Gentic host registration.")
}

function status(): void {
  const state = getAuthState()

  if (!state.authenticated) {
    log.info("No host connected. Run `gentic host connect <code>`.")
    return
  }

  log.info(`Host ID: ${state.hostId ?? "unknown"}`)
  log.info(`API URL: ${state.apiUrl}`)
  log.info(`Host credential: ${state.maskedHostCredential}`)
  log.info(`Setup: ${state.setupState ?? "ready"}`)
  log.info(`Agents: ${formatAgentProviders([...agentProviders])}`)
}
