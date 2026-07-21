import { availableCommandSchema } from "@gentic/validators/chat-events"
import type { AgentProvider } from "@gentic/validators/issues"

import type { ChatMessage } from "./types"

export type SlashCommand = {
  name: string
  description: string
  input?: { hint: string } | null
}

const CLAUDE_CODE_SLASH_COMMANDS: SlashCommand[] = [
  { name: "/init", description: "Generate or update project memory" },
  { name: "/memory", description: "Edit Claude memory files" },
  { name: "/mcp", description: "Manage MCP servers" },
  { name: "/permissions", description: "Change tool approval rules" },
  { name: "/plan", description: "Switch to planning mode" },
  { name: "/model", description: "Change the active model" },
  { name: "/effort", description: "Adjust reasoning effort" },
  { name: "/context", description: "Inspect context usage" },
  { name: "/compact", description: "Compact conversation history" },
  { name: "/clear", description: "Clear conversation context" },
  { name: "/diff", description: "Show current changes" },
  { name: "/review", description: "Review a pull request" },
  { name: "/code-review", description: "Review code changes" },
  { name: "/security-review", description: "Review security risk" },
  { name: "/tasks", description: "List background tasks" },
  { name: "/help", description: "Show available commands" },
]

const CODEX_SLASH_COMMANDS: SlashCommand[] = [
  { name: "/permissions", description: "Change approval rules" },
  { name: "/model", description: "Change the active model" },
  { name: "/reasoning", description: "Adjust reasoning effort" },
  { name: "/status", description: "Show task and context status" },
  { name: "/plan", description: "Toggle plan mode" },
  { name: "/compact", description: "Compact task context" },
  { name: "/review", description: "Start code review mode" },
  { name: "/init", description: "Generate AGENTS.md guidance" },
  { name: "/mcp", description: "Open MCP status" },
  { name: "/goal", description: "Set a persistent goal" },
  { name: "/agent", description: "Switch agent thread" },
  { name: "/subagents", description: "Switch agent thread" },
  { name: "/side", description: "Start a side conversation" },
  { name: "/ide", description: "Include IDE context" },
  { name: "/ide-context", description: "Toggle IDE context" },
  { name: "/fast", description: "Toggle fast service tier" },
  { name: "/feedback", description: "Send product feedback" },
  { name: "/local", description: "Run locally" },
  { name: "/cloud", description: "Run in the cloud" },
  { name: "/help", description: "Show available commands" },
]

export function slashCommandsForProvider(
  provider: AgentProvider
): SlashCommand[] {
  return provider === "codex"
    ? CODEX_SLASH_COMMANDS
    : CLAUDE_CODE_SLASH_COMMANDS
}

export function slashCommandQuery(value: string): string | null {
  if (!value.startsWith("/")) {
    return null
  }
  const firstLine = value.split("\n", 1)[0] ?? ""
  if (firstLine.includes(" ")) {
    return null
  }
  return firstLine.toLowerCase()
}

export function slashCommandName(value: string): string | null {
  const query = slashCommandQuery(value)
  if (query === null || query === "/") {
    return null
  }
  return query
}

export function filterSlashCommands(
  commands: SlashCommand[],
  query: string
): SlashCommand[] {
  return commands
    .filter((command) => command.name.toLowerCase().startsWith(query))
    .slice(0, 8)
}

export function slashCommandsFromMessages(
  messages: ChatMessage[]
): SlashCommand[] | null {
  const commandEvent = messages
    .filter((message) => message.event_type === "available_commands")
    .sort((a, b) => {
      const time = a.created_at.localeCompare(b.created_at)
      if (time !== 0) {
        return time
      }
      return (a.event_seq ?? 0) - (b.event_seq ?? 0)
    })
    .at(-1)

  const commands = commandEvent?.payload?.availableCommands
  if (!Array.isArray(commands)) {
    return null
  }

  return commands
    .map((command) => availableCommandSchema.safeParse(command))
    .filter((result) => result.success)
    .map((result) => ({
      ...result.data,
      name: slashName(result.data.name),
    }))
}

function slashName(name: string): string {
  return name.startsWith("/") ? name : `/${name}`
}
