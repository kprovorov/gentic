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
  workerId?: string
  apiUrl?: string
  maskedWorkerCredential?: string
  setupState?: "setup-incomplete" | "ready"
}

/** Reused by any future `gentic status` dashboard that wants auth info. */
export function getAuthState(): AuthState {
  const config = getConfigInput()
  if (
    !config.GENTIC_WORKER_ID ||
    !config.GENTIC_WORKER_CREDENTIAL ||
    !config.GENTIC_API_URL
  ) {
    return { authenticated: false }
  }
  return {
    authenticated: true,
    workerId: config.GENTIC_WORKER_ID,
    apiUrl: config.GENTIC_API_URL,
    maskedWorkerCredential: maskWorkerCredential(
      config.GENTIC_WORKER_CREDENTIAL
    ),
    setupState: config.GENTIC_WORKER_SETUP_STATE ?? "ready",
  }
}

function maskWorkerCredential(credential: string): string {
  const suffix = credential.slice(-4)
  return `${credential.slice(0, 3)}...${suffix}`
}

export function registerAuthCommand(program: Command): void {
  const auth = program
    .command("auth")
    .description("Manage Gentic API credentials")

  auth
    .command("login")
    .description("Deprecated: connect a Gentic worker instead")
    .action(() => {
      logError(
        "auth login has been replaced. Generate a worker code in Gentic, then run `gentic worker connect <code>`."
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
    "auth login has been replaced. Generate a worker code in Gentic, then run `gentic worker connect <code>`."
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
    GENTIC_WORKER_ID: undefined,
    GENTIC_WORKER_CREDENTIAL: undefined,
    GENTIC_API_URL: undefined,
    GENTIC_WORKER_SETUP_STATE: undefined,
  })
  log.success("Cleared stored Gentic worker registration.")
}

function status(): void {
  const state = getAuthState()

  if (!state.authenticated) {
    log.info("No worker connected. Run `gentic worker connect <code>`.")
    return
  }

  log.info(`Worker ID: ${state.workerId ?? "unknown"}`)
  log.info(`API URL: ${state.apiUrl}`)
  log.info(`Worker credential: ${state.maskedWorkerCredential}`)
  log.info(`Setup: ${state.setupState ?? "ready"}`)
  log.info(`Agents: ${formatAgentProviders([...agentProviders])}`)
}
