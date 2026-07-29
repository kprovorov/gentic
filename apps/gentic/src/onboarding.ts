import type { AgentProvider } from "./agents.js"
import { agentProviders, formatAgentProviders } from "./agents.js"
import { setupAgentCLIs } from "./agent-cli-setup.js"
import { startGenticService } from "./commands/service.js"
import { getConfigInput } from "./config.js"
import type { ConfigFile } from "./config-store.js"
import { markWorkerSetupReady } from "./enrollment.js"
import {
  detectHomebrew,
  detectLinuxPackageManager,
  detectPlatform,
  spawnInteractive,
} from "./installers.js"
import {
  checkGithub,
  formatToolStatus,
  getToolStatuses,
  type ToolStatus,
  type ToolStatuses,
} from "./tools.js"
import { cancel, confirm, intro, isCancel, log, outro } from "./ui.js"

export type OnboardingRequirement =
  | "gentic-auth"
  | "worker-setup-incomplete"
  | "github-cli-installed"
  | "github-cli-authenticated"
  | "agent-cli-installed"
  | "agent-cli-authenticated"

export interface OnboardingAuthStatus {
  authenticated: boolean
  workerId?: string
  apiUrl?: string
  maskedWorkerCredential?: string
  setupState?: ConfigFile["GENTIC_WORKER_SETUP_STATE"]
  missing: (
    | "GENTIC_WORKER_ID"
    | "GENTIC_WORKER_CREDENTIAL"
    | "GENTIC_API_URL"
  )[]
}

export interface OnboardingStatus {
  ready: boolean
  auth: OnboardingAuthStatus
  agentProviders: AgentProvider[]
  tools: ToolStatuses
  unmet: OnboardingRequirement[]
}

interface OnboardingStatusDeps {
  configInput?: Partial<ConfigFile>
  getTools?: () => Promise<ToolStatuses>
}

type OnboardingStepId = "auth" | "gh" | "agent" | "worker"

export interface OnboardingStep {
  id: OnboardingStepId
  label: string
}

interface RunOnboardingDeps {
  getStatus?: () => Promise<OnboardingStatus>
  confirm?: typeof confirm
  cancel?: typeof cancel
  ensureGithubCli?: typeof ensureGithubCliForOnboarding
  setupAgentCLIs?: typeof setupAgentCLIs
  ensureAgentCli?: () => Promise<OnboardingStatus>
  markWorkerReady?: typeof markWorkerSetupReady
  startWorker?: typeof startGenticService
  ui?: {
    intro: typeof intro
    outro: typeof outro
    info: typeof log.info
    success: typeof log.success
    warn: typeof log.warn
  }
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  { id: "auth", label: "Gentic auth" },
  { id: "gh", label: "GitHub CLI" },
  { id: "agent", label: "Agent CLI" },
  { id: "worker", label: "Worker service" },
]

export interface GithubInstallCommand {
  command: string
  args: string[]
  display: string
}

interface GithubCliOnboardingDeps {
  checkGithub?: () => Promise<ToolStatus>
  confirm?: typeof confirm
  cancel?: typeof cancel
  platform?: NodeJS.Platform
  path?: string
  spawnInteractive?: typeof spawnInteractive
  exit?: (code: number) => never
}

interface AgentCliOnboardingDeps {
  configInput?: Partial<ConfigFile>
  getStatus?: (deps?: OnboardingStatusDeps) => Promise<OnboardingStatus>
  cancel?: typeof cancel
  exit?: (code: number) => never
}

const GITHUB_REQUIRED_MESSAGE =
  "gh is required to run gentic. Install and authenticate GitHub CLI, then run onboarding again."
const AGENT_REQUIRED_MESSAGE =
  "both Claude Code and Codex must be installed and authenticated to run gentic"

function maskWorkerCredential(apiKey: string): string {
  const suffix = apiKey.slice(-4)
  return `${apiKey.slice(0, 3)}...${suffix}`
}

function authStatus(config: Partial<ConfigFile>): OnboardingAuthStatus {
  const missing: OnboardingAuthStatus["missing"] = []
  if (!config.GENTIC_WORKER_ID) missing.push("GENTIC_WORKER_ID")
  if (!config.GENTIC_WORKER_CREDENTIAL) missing.push("GENTIC_WORKER_CREDENTIAL")
  if (!config.GENTIC_API_URL) missing.push("GENTIC_API_URL")

  if (missing.length > 0) {
    return {
      authenticated: false,
      workerId: config.GENTIC_WORKER_ID,
      apiUrl: config.GENTIC_API_URL,
      maskedWorkerCredential: config.GENTIC_WORKER_CREDENTIAL
        ? maskWorkerCredential(config.GENTIC_WORKER_CREDENTIAL)
        : undefined,
      setupState: config.GENTIC_WORKER_SETUP_STATE,
      missing,
    }
  }

  return {
    authenticated: true,
    workerId: config.GENTIC_WORKER_ID,
    apiUrl: config.GENTIC_API_URL,
    maskedWorkerCredential: maskWorkerCredential(config.GENTIC_WORKER_CREDENTIAL ?? ""),
    setupState: config.GENTIC_WORKER_SETUP_STATE ?? "ready",
    missing,
  }
}

function getAgentTools(tools: ToolStatuses): ToolStatus[] {
  return [
    tools.claude ?? { installed: false, authenticated: false, version: null },
    tools.codex ?? { installed: false, authenticated: false, version: null },
  ]
}

function unmetRequirements(
  auth: OnboardingAuthStatus,
  tools: ToolStatuses
): OnboardingRequirement[] {
  const unmet: OnboardingRequirement[] = []

  if (!auth.authenticated) unmet.push("gentic-auth")
  if (auth.authenticated && auth.setupState === "setup-incomplete") {
    unmet.push("worker-setup-incomplete")
  }
  if (!tools.github.installed) unmet.push("github-cli-installed")
  else if (!tools.github.authenticated) unmet.push("github-cli-authenticated")

  const agentTools = getAgentTools(tools)
  if (agentTools.some((tool) => !tool.installed)) {
    unmet.push("agent-cli-installed")
  } else if (agentTools.some((tool) => !tool.authenticated)) {
    unmet.push("agent-cli-authenticated")
  }

  return unmet
}

export async function getOnboardingStatus(
  deps: OnboardingStatusDeps = {}
): Promise<OnboardingStatus> {
  const config = deps.configInput ?? getConfigInput()
  const tools = await (deps.getTools ?? getToolStatuses)()
  const auth = authStatus(config)
  const unmet = unmetRequirements(auth, tools)

  return {
    ready: unmet.length === 0,
    auth,
    agentProviders: [...agentProviders],
    tools,
    unmet,
  }
}

export function formatOnboardingUnmet(status: OnboardingStatus): string[] {
  const lines: string[] = []

  if (status.unmet.includes("gentic-auth")) {
    lines.push(
      `Gentic worker registration: missing ${status.auth.missing.join(
        " and "
      )}. Run \`gentic worker connect <code>\`.`
    )
  }

  if (status.unmet.includes("worker-setup-incomplete")) {
    lines.push("Gentic worker setup: incomplete. Run `gentic onboard` to resume.")
  }

  if (status.unmet.includes("github-cli-installed")) {
    lines.push("GitHub CLI: gh is not installed")
  } else if (status.unmet.includes("github-cli-authenticated")) {
    lines.push("GitHub CLI: gh is installed but not authenticated")
  }

  if (
    status.unmet.includes("agent-cli-installed") ||
    status.unmet.includes("agent-cli-authenticated")
  ) {
    const agents = Object.entries({
      Claude: status.tools.claude,
      Codex: status.tools.codex,
    })
      .filter(([, tool]) => tool !== undefined)
      .map(([name, tool]) => `${name} ${formatToolStatus(tool as ToolStatus)}`)
      .join(", ")
    lines.push(
      `${formatAgentProviders(status.agentProviders)}: all agent CLIs must be installed and authenticated (${agents})`
    )
  }

  return lines
}

function formatStep(index: number, label: string): string {
  return `Step ${index + 1}/${ONBOARDING_STEPS.length}: ${label}`
}

async function runAuthStep(
  status: OnboardingStatus,
  deps: Pick<RunOnboardingDeps, "ui">
): Promise<void> {
  const ui = deps.ui
  ui?.info(formatStep(0, ONBOARDING_STEPS[0].label))

  if (status.auth.authenticated) {
    ui?.success(
      `Gentic worker connected (${status.auth.workerId}, ${status.auth.maskedWorkerCredential}, ${status.auth.apiUrl}).`
    )
    return
  }

  ui?.warn("No Gentic worker is connected. Run `gentic worker connect <code>`.")
}

async function runGithubStep(
  status: OnboardingStatus,
  deps: Pick<RunOnboardingDeps, "ensureGithubCli" | "ui">
): Promise<void> {
  const ui = deps.ui
  ui?.info(formatStep(1, ONBOARDING_STEPS[1].label))
  if (status.tools.github.installed && status.tools.github.authenticated) {
    ui?.success("GitHub CLI is installed and authenticated.")
    return
  }

  await (deps.ensureGithubCli ?? ensureGithubCliForOnboarding)()
}

async function runAgentStep(
  status: OnboardingStatus,
  deps: Pick<RunOnboardingDeps, "setupAgentCLIs" | "ui">
): Promise<boolean> {
  const ui = deps.ui
  ui?.info(formatStep(2, ONBOARDING_STEPS[2].label))
  return (deps.setupAgentCLIs ?? setupAgentCLIs)(status.tools)
}

function reportAgentStep(
  status: OnboardingStatus,
  ui: RunOnboardingDeps["ui"]
): void {
  const agentTools = getAgentTools(status.tools)

  if (agentTools.some((tool) => !tool.installed)) {
    ui?.warn("At least one agent CLI is not installed.")
  } else if (agentTools.some((tool) => !tool.authenticated)) {
    ui?.warn("At least one agent CLI is not authenticated.")
  } else {
    ui?.success(
      `${formatAgentProviders(status.agentProviders)} has an authenticated CLI.`
    )
  }
}

function formatOnboardingSummary(status: OnboardingStatus): string[] {
  const auth = status.auth.authenticated
    ? `connected (${status.auth.workerId}, ${status.auth.maskedWorkerCredential}, ${status.auth.apiUrl})`
    : "not configured"
  const agents = Object.entries({
    Claude: status.tools.claude,
    Codex: status.tools.codex,
  })
    .filter(([, tool]) => tool !== undefined)
    .map(([name, tool]) => `${name} ${formatToolStatus(tool as ToolStatus)}`)
    .join(", ")

  return [
    `Gentic auth: ${auth}`,
    `GitHub CLI: ${formatToolStatus(status.tools.github)}`,
    `Agent CLI: ${agents || "no agent CLI"}`,
  ]
}

async function runWorkerStep(
  status: OnboardingStatus,
  deps: Pick<RunOnboardingDeps, "confirm" | "startWorker" | "ui">
): Promise<boolean> {
  const ui = deps.ui
  const prompt = deps.confirm ?? confirm
  const startWorker = deps.startWorker ?? startGenticService

  ui?.info(formatStep(3, ONBOARDING_STEPS[3].label))
  for (const line of formatOnboardingSummary(status)) {
    ui?.info(line)
  }

  const confirmed = await prompt({
    message: "Enable the gentic worker now?",
  })
  if (isCancel(confirmed) || !confirmed) {
    ui?.info("Run `gentic start` later to enable the worker.")
    return true
  }

  return startWorker()
}

function hasOnlySetupIncomplete(status: OnboardingStatus): boolean {
  return (
    status.unmet.length === 1 &&
    status.unmet[0] === "worker-setup-incomplete"
  )
}

export async function runOnboarding(
  deps: RunOnboardingDeps = {}
): Promise<void> {
  const ui = deps.ui ?? {
    intro,
    outro,
    info: log.info,
    success: log.success,
    warn: log.warn,
  }
  const getStatus = deps.getStatus ?? (() => getOnboardingStatus())

  ui.intro("Welcome to Gentic")

  let status = await getStatus()
  await runAuthStep(status, { ui })

  if (!status.auth.authenticated) {
    for (const line of formatOnboardingUnmet(status)) {
      ui.warn(line)
    }
    ui.outro("Connect this worker first.")
    return
  }

  await runGithubStep(status, {
    ensureGithubCli: deps.ensureGithubCli,
    ui,
  })
  status = await getStatus()

  const completedAgentSetup = await runAgentStep(status, {
    setupAgentCLIs: deps.setupAgentCLIs,
    ui,
  })
  if (!completedAgentSetup) return

  status = await (deps.ensureAgentCli ??
    (() => ensureAgentCliForOnboarding()))()
  reportAgentStep(status, ui)

  if (hasOnlySetupIncomplete(status)) {
    await (deps.markWorkerReady ?? markWorkerSetupReady)()
    status = await getStatus()
  }

  if (!status.ready) {
    for (const line of formatOnboardingUnmet(status)) {
      ui.warn(line)
    }
    ui.outro("Onboarding checks incomplete.")
    return
  }

  const workerComplete = await runWorkerStep(status, {
    confirm: deps.confirm,
    startWorker: deps.startWorker,
    ui,
  })
  if (!workerComplete) {
    ui.outro("Onboarding checks complete, but the worker did not start.")
    return
  }

  ui.outro("Onboarding checks complete.")
}

export function getGithubInstallCommand(
  platform: NodeJS.Platform = process.platform,
  pathValue: string | undefined = process.env.PATH
): GithubInstallCommand {
  const supportedPlatform = detectPlatform(platform)

  if (supportedPlatform === "darwin") {
    if (!detectHomebrew(pathValue)) {
      throw new Error(
        "Homebrew is required to install gh on macOS. Install Homebrew from https://brew.sh/ and run onboarding again."
      )
    }
    return {
      command: "brew",
      args: ["install", "gh"],
      display: "brew install gh",
    }
  }

  const manager = detectLinuxPackageManager(pathValue)
  if (!manager) {
    throw new Error(
      "No supported Linux package manager found for installing gh. Install GitHub CLI from https://cli.github.com/ and run onboarding again."
    )
  }

  return {
    command: "sudo",
    args: [manager, "install", "-y", "gh"],
    display: `sudo ${manager} install -y gh`,
  }
}

export async function ensureGithubCliForOnboarding(
  deps: GithubCliOnboardingDeps = {}
): Promise<void> {
  const check = deps.checkGithub ?? checkGithub
  const prompt = deps.confirm ?? confirm
  const cancelPrompt = deps.cancel ?? cancel
  const run = deps.spawnInteractive ?? spawnInteractive
  const exit = deps.exit ?? process.exit

  let status = await check()
  if (status.installed && status.authenticated) return

  if (!status.installed) {
    const install = getGithubInstallCommand(deps.platform, deps.path)
    const confirmed = await prompt({
      message: `Install GitHub CLI with \`${install.display}\`?`,
    })
    if (isCancel(confirmed) || !confirmed) {
      cancelPrompt(GITHUB_REQUIRED_MESSAGE)
      exit(1)
    }

    await run(install.command, install.args)
    status = await check()
  }

  if (!status.authenticated) {
    const confirmed = await prompt({
      message: "Authenticate GitHub CLI with `gh auth login`?",
    })
    if (isCancel(confirmed) || !confirmed) {
      cancelPrompt(GITHUB_REQUIRED_MESSAGE)
      exit(1)
    }

    await run("gh", ["auth", "login"])
    const authenticated = await check()
    if (!authenticated.authenticated) {
      log.error("GitHub CLI is still not authenticated.")
      exit(1)
    }
  }
}

export async function ensureAgentCliForOnboarding(
  deps: AgentCliOnboardingDeps = {}
): Promise<OnboardingStatus> {
  const getStatus = deps.getStatus ?? getOnboardingStatus
  const cancelPrompt = deps.cancel ?? cancel
  const exit = deps.exit ?? process.exit
  const status = await getStatus(
    deps.configInput ? { configInput: deps.configInput } : undefined
  )

  const hasAuthenticatedAgent = getAgentTools(status.tools).some(
    (tool) => tool.installed && tool.authenticated
  )
  if (hasAuthenticatedAgent) return status

  cancelPrompt(AGENT_REQUIRED_MESSAGE)
  return exit(1)
}
