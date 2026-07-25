import type { AgentProvider } from "./agents.js"
import { DEFAULT_AGENT_PROVIDERS, formatAgentProviders } from "./agents.js"
import type { AuthLoginPromptResult } from "./auth-login.js"
import { runAuthLoginPrompt } from "./auth-login.js"
import { getConfigInput } from "./config.js"
import type { ConfigFile } from "./config-store.js"
import {
  formatToolStatus,
  getToolStatuses,
  type ToolStatus,
  type ToolStatuses,
} from "./tools.js"
import { intro, log, outro } from "./ui.js"

export type OnboardingRequirement =
  | "gentic-auth"
  | "github-cli-installed"
  | "github-cli-authenticated"
  | "agent-cli-installed"
  | "agent-cli-authenticated"

export interface OnboardingAuthStatus {
  authenticated: boolean
  apiUrl?: string
  maskedApiKey?: string
  missing: ("GENTIC_API_KEY" | "GENTIC_API_URL")[]
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
  getTools?: (agentProviders: AgentProvider[]) => Promise<ToolStatuses>
}

type OnboardingStepId = "auth" | "gh" | "agent" | "worker"

export interface OnboardingStep {
  id: OnboardingStepId
  label: string
}

interface RunOnboardingDeps {
  getStatus?: () => Promise<OnboardingStatus>
  runAuthLogin?: () => Promise<AuthLoginPromptResult>
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

const ALL_AGENT_PROVIDERS: AgentProvider[] = ["claude_code", "codex"]

function maskApiKey(apiKey: string): string {
  const suffix = apiKey.slice(-4)
  return `${apiKey.slice(0, 3)}...${suffix}`
}

function configuredAgentProviders(
  config: Partial<ConfigFile>
): AgentProvider[] {
  const value = config.AGENT_PROVIDERS
  const raw =
    typeof value === "string"
      ? value.split(",").map((item) => item.trim())
      : Array.isArray(value)
        ? value
      : ALL_AGENT_PROVIDERS
  const selected = raw.filter((item): item is AgentProvider =>
    ALL_AGENT_PROVIDERS.includes(item as AgentProvider)
  )
  return selected.length > 0 ? [...new Set(selected)] : DEFAULT_AGENT_PROVIDERS
}

function authStatus(config: Partial<ConfigFile>): OnboardingAuthStatus {
  const missing: OnboardingAuthStatus["missing"] = []
  if (!config.GENTIC_API_KEY) missing.push("GENTIC_API_KEY")
  if (!config.GENTIC_API_URL) missing.push("GENTIC_API_URL")

  if (missing.length > 0) {
    return {
      authenticated: false,
      apiUrl: config.GENTIC_API_URL,
      maskedApiKey: config.GENTIC_API_KEY
        ? maskApiKey(config.GENTIC_API_KEY)
        : undefined,
      missing,
    }
  }

  return {
    authenticated: true,
    apiUrl: config.GENTIC_API_URL,
    maskedApiKey: maskApiKey(config.GENTIC_API_KEY ?? ""),
    missing,
  }
}

function getAgentTools(tools: ToolStatuses): ToolStatus[] {
  return [tools.claude, tools.codex].filter(
    (tool): tool is ToolStatus => tool !== undefined
  )
}

function unmetRequirements(
  auth: OnboardingAuthStatus,
  tools: ToolStatuses
): OnboardingRequirement[] {
  const unmet: OnboardingRequirement[] = []

  if (!auth.authenticated) unmet.push("gentic-auth")
  if (!tools.github.installed) unmet.push("github-cli-installed")
  else if (!tools.github.authenticated) unmet.push("github-cli-authenticated")

  const agentTools = getAgentTools(tools)
  if (!agentTools.some((tool) => tool.installed)) {
    unmet.push("agent-cli-installed")
  } else if (!agentTools.some((tool) => tool.installed && tool.authenticated)) {
    unmet.push("agent-cli-authenticated")
  }

  return unmet
}

export async function getOnboardingStatus(
  deps: OnboardingStatusDeps = {}
): Promise<OnboardingStatus> {
  const config = deps.configInput ?? getConfigInput()
  const agentProviders = configuredAgentProviders(config)
  const tools = await (deps.getTools ?? getToolStatuses)(agentProviders)
  const auth = authStatus(config)
  const unmet = unmetRequirements(auth, tools)

  return {
    ready: unmet.length === 0,
    auth,
    agentProviders,
    tools,
    unmet,
  }
}

export function formatOnboardingUnmet(status: OnboardingStatus): string[] {
  const lines: string[] = []

  if (status.unmet.includes("gentic-auth")) {
    lines.push(
      `Gentic API credentials: missing ${status.auth.missing.join(" and ")}`
    )
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
      `${formatAgentProviders(status.agentProviders)}: at least one selected agent CLI must be installed and authenticated (${agents})`
    )
  }

  return lines
}

function formatStep(index: number, label: string): string {
  return `Step ${index + 1}/${ONBOARDING_STEPS.length}: ${label}`
}

async function runAuthStep(
  status: OnboardingStatus,
  deps: Required<Pick<RunOnboardingDeps, "runAuthLogin">> &
    Pick<RunOnboardingDeps, "ui">
): Promise<"completed" | "cancelled" | "skipped"> {
  const ui = deps.ui
  ui?.info(formatStep(0, ONBOARDING_STEPS[0].label))

  if (status.auth.authenticated) {
    ui?.success(
      `Gentic auth already configured (${status.auth.maskedApiKey}, ${status.auth.apiUrl}).`
    )
    return "skipped"
  }

  const login = await deps.runAuthLogin()
  return login.cancelled ? "cancelled" : "completed"
}

function reportGithubStep(status: OnboardingStatus, ui: RunOnboardingDeps["ui"]): void {
  ui?.info(formatStep(1, ONBOARDING_STEPS[1].label))
  if (!status.tools.github.installed) {
    ui?.warn("GitHub CLI is not installed.")
  } else if (!status.tools.github.authenticated) {
    ui?.warn("GitHub CLI is installed but not authenticated.")
  } else {
    ui?.success("GitHub CLI is installed and authenticated.")
  }
}

function reportAgentStep(status: OnboardingStatus, ui: RunOnboardingDeps["ui"]): void {
  ui?.info(formatStep(2, ONBOARDING_STEPS[2].label))
  const agentTools = getAgentTools(status.tools)

  if (!agentTools.some((tool) => tool.installed)) {
    ui?.warn("No selected agent CLI is installed.")
  } else if (
    !agentTools.some((tool) => tool.installed && tool.authenticated)
  ) {
    ui?.warn("No selected agent CLI is authenticated.")
  } else {
    ui?.success(
      `${formatAgentProviders(status.agentProviders)} has an authenticated CLI.`
    )
  }
}

function reportWorkerStep(ui: RunOnboardingDeps["ui"]): void {
  ui?.info(formatStep(3, ONBOARDING_STEPS[3].label))
  ui?.info("Worker setup will be connected here in a follow-up.")
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
  const runAuthLogin = deps.runAuthLogin ?? runAuthLoginPrompt

  ui.intro("Welcome to Gentic")

  let status = await getStatus()
  const authResult = await runAuthStep(status, { runAuthLogin, ui })
  if (authResult === "cancelled") return

  if (authResult === "completed") {
    status = await getStatus()
  }

  reportGithubStep(status, ui)
  reportAgentStep(status, ui)
  reportWorkerStep(ui)

  ui.outro("Onboarding checks complete.")
}
