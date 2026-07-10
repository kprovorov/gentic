import type { Command } from "commander"

import { getServiceBackend } from "../service/index.js"
import type { ServiceScope, ServiceStatus } from "../service/index.js"
import { formatToolStatus, getToolStatuses } from "../tools.js"
import type { ToolStatus, ToolStatuses } from "../tools.js"
import { log, note } from "../ui.js"
import { getAuthState } from "./auth.js"

interface StatusOptions {
  system?: boolean
  json?: boolean
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatUptime(since: Date): string {
  const totalSeconds = Math.max(
    0,
    Math.floor((Date.now() - since.getTime()) / 1000)
  )
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function toolsJson(tools: ToolStatuses) {
  return {
    github: tools.github,
    claude: tools.claude,
    codex: tools.codex,
  }
}

// Only colorize when stdout is a real terminal and the user hasn't opted out
// (https://no-color.org), matching how most CLIs decide whether to emit ANSI.
const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR

function colorize(code: number, text: string): string {
  return useColor ? `\x1b[${code}m${text}\x1b[0m` : text
}

function statusIcon(status: ToolStatus): string {
  if (!status.installed) return colorize(31, "✗") // red ✗
  if (!status.authenticated) return colorize(33, "⚠") // yellow/orange ⚠
  return colorize(32, "✓") // green ✓
}

function formatToolLines(tools: ToolStatuses): string[] {
  const rows: [string, ToolStatus][] = [
    ["GitHub CLI", tools.github],
    ["Claude", tools.claude],
    ["Codex", tools.codex],
  ]
  const labelWidth = Math.max(...rows.map(([label]) => label.length))

  return rows.map(([label, tool]) => {
    const version = tool.version ? ` (v${tool.version})` : ""
    const icon = statusIcon(tool)
    const status = formatToolStatus(tool)
    return `${icon} ${label.padEnd(labelWidth)}  ${status}${version}`
  })
}

function formatServiceLine(
  scope: ServiceScope,
  backendName: string,
  serviceStatus: ServiceStatus
): string {
  const details = [`${backendName} --${scope}`]
  if (serviceStatus.pid !== undefined) details.push(`pid ${serviceStatus.pid}`)
  if (serviceStatus.since !== undefined) {
    details.push(`up ${formatUptime(serviceStatus.since)}`)
  }
  return `${serviceStatus.state} (${details.join(", ")})`
}

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show whether gentic is configured, running, and its last run")
    .option(
      "--system",
      "check the system-wide service instead of the per-user one (Linux/systemd only)"
    )
    .option("--json", "output machine-readable JSON instead of styled text")
    .action(async (opts: StatusOptions) => {
      await status(opts)
    })
}

async function status(opts: StatusOptions): Promise<void> {
  const auth = getAuthState()
  const tools = await getToolStatuses()

  if (!auth.authenticated) {
    if (opts.json) {
      console.log(
        JSON.stringify({ auth: "not-configured", tools: toolsJson(tools) })
      )
      return
    }
    log.warn('Auth: not configured — run "gentic auth login"')
    note(formatToolLines(tools).join("\n"), "Tools")
    return
  }

  const scope: ServiceScope = opts.system ? "system" : "user"

  let backendName = "unknown"
  let serviceStatus: ServiceStatus = { state: "not-installed" }
  let bootEnabled = false
  try {
    const backend = getServiceBackend({ scope })
    backendName = backend.name
    ;[serviceStatus, bootEnabled] = await Promise.all([
      backend.status(),
      backend.isEnabledOnBoot(),
    ])
  } catch (error) {
    if (opts.json) {
      console.log(
        JSON.stringify({
          auth: "configured",
          apiUrl: auth.apiUrl,
          maskedApiKey: auth.maskedApiKey,
          serviceError: describe(error),
          tools: toolsJson(tools),
        })
      )
      return
    }
    log.warn(`Service: unable to determine status (${describe(error)})`)
    note(formatToolLines(tools).join("\n"), "Tools")
    return
  }

  // No read-only Gentic API endpoint reports the last run for a key's issues
  // yet, so this line degrades instead of pretending to have checked. See PR
  // description for the follow-up to add one.
  const lastRun = "unknown (no API support yet)"

  if (opts.json) {
    console.log(
      JSON.stringify({
        auth: "configured",
        apiUrl: auth.apiUrl,
        maskedApiKey: auth.maskedApiKey,
        service: serviceStatus.state,
        serviceBackend: backendName,
        pid: serviceStatus.pid,
        uptimeSeconds: serviceStatus.since
          ? Math.max(
              0,
              Math.floor((Date.now() - serviceStatus.since.getTime()) / 1000)
            )
          : undefined,
        bootEnabled,
        lastRun,
        tools: toolsJson(tools),
      })
    )
    return
  }

  note(
    [
      `Auth:     configured (api key: ${auth.maskedApiKey}, url: ${auth.apiUrl})`,
      `Service:  ${formatServiceLine(scope, backendName, serviceStatus)}`,
      `Boot:     ${bootEnabled ? "enabled" : "disabled"}`,
      `Last run: ${lastRun}`,
      ...formatToolLines(tools),
    ].join("\n"),
    "gentic status"
  )
}
