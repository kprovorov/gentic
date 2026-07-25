import type { Command } from "commander"

import {
  DEFAULT_AGENT_PROVIDERS,
  formatAgentProviders,
  parseAgentProviders,
} from "../agents.js"
import { setupSelectedAgentCLIs } from "../agent-cli-setup.js"
import {
  DEFAULT_API_URL,
  runAuthLoginPrompt,
  unvalidatedKeyNotice,
} from "../auth-login.js"
import { getConfigInput } from "../config.js"
import {
  configFilePath,
  writeConfigFile,
} from "../config-store.js"
import { logError, logInfo } from "../log.js"
import {
  ensureAgentCliForOnboarding,
  ensureGithubCliForOnboarding,
  formatOnboardingUnmet,
  getOnboardingStatus,
} from "../onboarding.js"
import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  outro,
  select,
} from "../ui.js"

export interface AuthState {
  authenticated: boolean
  apiUrl?: string
  maskedApiKey?: string
  agentProviders: ReturnType<typeof parseAgentProviders>
}

/** Reused by any future `gentic status` dashboard that wants auth info. */
export function getAuthState(): AuthState {
  const config = getConfigInput()
  const agentProviders = parseAgentProviders(config.AGENT_PROVIDERS)
  if (!config.GENTIC_API_KEY || !config.GENTIC_API_URL) {
    return { authenticated: false, agentProviders }
  }
  return {
    authenticated: true,
    apiUrl: config.GENTIC_API_URL,
    maskedApiKey: maskApiKey(config.GENTIC_API_KEY),
    agentProviders,
  }
}

function maskApiKey(apiKey: string): string {
  const suffix = apiKey.slice(-4)
  return `${apiKey.slice(0, 3)}...${suffix}`
}

export function registerAuthCommand(program: Command): void {
  const auth = program
    .command("auth")
    .description("Manage Gentic API credentials")

  auth
    .command("login")
    .description("Save Gentic API credentials")
    .option("--api-url <url>", "Gentic API URL")
    .option("--api-key <key>", "Gentic API key")
    .action(async (opts: { apiUrl?: string; apiKey?: string }) => {
      if (opts.apiUrl !== undefined || opts.apiKey !== undefined) {
        loginNonInteractive(opts)
      } else {
        await loginInteractive()
      }
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

function loginNonInteractive(opts: { apiUrl?: string; apiKey?: string }): void {
  const apiUrl = opts.apiUrl ?? DEFAULT_API_URL
  const apiKey = opts.apiKey

  if (!apiKey) {
    logError("auth login: --api-key is required")
    process.exitCode = 1
    return
  }

  writeConfigFile({
    GENTIC_API_KEY: apiKey,
    GENTIC_API_URL: apiUrl,
    AGENT_PROVIDERS: DEFAULT_AGENT_PROVIDERS,
  })
  logInfo(
    `auth login: saved to ${configFilePath()} (${unvalidatedKeyNotice()})`
  )
}

export async function loginInteractive(): Promise<void> {
  intro("gentic auth login")
  const login = await runAuthLoginPrompt()
  if (login.cancelled) return

  const agentSelection = await select({
    message: "Which coding agent(s) will this worker run?",
    initialValue: "claude_code",
    options: [
      { value: "claude_code", label: "Claude Code" },
      { value: "codex", label: "Codex" },
      { value: "claude_code,codex", label: "Claude Code and Codex" },
    ],
  })
  if (isCancel(agentSelection)) {
    cancel("Cancelled.")
    return
  }

  const selectedAgentProviders = parseAgentProviders(agentSelection)
  writeConfigFile({
    GENTIC_API_URL: login.apiUrl,
    AGENT_PROVIDERS: selectedAgentProviders,
  })

  await ensureGithubCliForOnboarding()

  let current = await getOnboardingStatus({
    configInput: {
      ...getConfigInput(),
      AGENT_PROVIDERS: selectedAgentProviders,
    },
  })
  const completedSetup = await setupSelectedAgentCLIs(
    selectedAgentProviders,
    current.tools
  )
  if (!completedSetup) return
  current = await ensureAgentCliForOnboarding({
    configInput: {
      ...getConfigInput(),
      AGENT_PROVIDERS: selectedAgentProviders,
    },
  })

  if (login.apiKeyConfigured && current.ready) {
    outro(
      `Saved to ${configFilePath()} (${formatAgentProviders(selectedAgentProviders)})`
    )
    return
  }

  outro(`Saved to ${configFilePath()}`)
  for (const line of formatOnboardingUnmet(current)) {
    log.warn(line)
  }
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
  // settings (AGENT_PROVIDERS, GIT_REMOTE_BASE, WORKDIR, POLL_INTERVAL_MS)
  // survive a logout.
  writeConfigFile({ GENTIC_API_KEY: undefined, GENTIC_API_URL: undefined })
  log.success("Cleared stored Gentic API credentials.")
}

function status(): void {
  const state = getAuthState()

  if (!state.authenticated) {
    log.info("Not authenticated. Run `gentic auth login`.")
    return
  }

  log.info(`API URL: ${state.apiUrl}`)
  log.info(`API key: ${state.maskedApiKey}`)
  log.info(`Agents: ${formatAgentProviders(state.agentProviders)}`)
}
