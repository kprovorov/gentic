import type { Command } from "commander"

import { getServiceBackend } from "../service/index.js"
import type { ServiceScope } from "../service/index.js"
import { log } from "../ui.js"

interface LogsOptions {
  system?: boolean
  follow?: boolean
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function registerLogsCommand(program: Command): void {
  program
    .command("logs")
    .description("Show logs for the gentic worker service")
    .option(
      "--system",
      "show logs for the system-wide service instead of the per-user one (Linux/systemd only)"
    )
    .option("-f, --follow", "follow the log output as it's written")
    .action(async (opts: LogsOptions) => {
      const scope: ServiceScope = opts.system ? "system" : "user"
      try {
        const backend = getServiceBackend({ scope })
        await backend.logs({ follow: opts.follow ?? false })
      } catch (error) {
        log.error(describe(error))
        process.exitCode = 1
      }
    })
}
