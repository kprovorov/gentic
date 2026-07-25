import type { AgentProvider } from "./agents.js"
import { DEFAULT_AGENT_PROVIDERS, formatAgentProviders } from "./agents.js"
import { getConfigInput } from "./config.js"
import type { ConfigFile } from "./config-store.js"
import {
  formatToolStatus,
  getToolStatuses,
  type ToolStatus,
  type ToolStatuses,
} from "./tools.js"

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
