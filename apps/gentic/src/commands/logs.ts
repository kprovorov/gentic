import { InvalidArgumentError } from "commander"
import type { Command } from "commander"

import { getServiceBackend } from "../service/index.js"
import type { ServiceScope } from "../service/index.js"
import { log } from "../ui.js"

const DEFAULT_LINES = 100

interface LogsOptions {
  system?: boolean
  follow?: boolean
  lines: number
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function parseLines(value: string): number {
  const lines = Number(value)
  if (!Number.isInteger(lines) || lines <= 0) {
    throw new InvalidArgumentError("expected a positive whole number of lines")
  }
  return lines
}

export function registerLogsCommand(program: Command): void {
  program
    .command("logs")
    .description("Show logs for the gentic host service")
    .option(
      "--system",
      "show logs for the system-wide service instead of the per-user one (Linux/systemd only)"
    )
    .option("-f, --follow", "follow the log output as it's written")
    .option(
      "-n, --lines <count>",
      "number of trailing log lines to show",
      parseLines,
      DEFAULT_LINES
    )
    .action(async (opts: LogsOptions) => {
      const scope: ServiceScope = opts.system ? "system" : "user"
      try {
        const backend = getServiceBackend({ scope })
        await backend.logs({ follow: opts.follow ?? false, lines: opts.lines })
      } catch (error) {
        log.error(describe(error))
        process.exitCode = 1
      }
    })
}
