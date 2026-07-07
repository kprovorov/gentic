import type { Command } from "commander"

import { getServiceBackend } from "../service/index.js"
import type { ServiceScope } from "../service/index.js"
import { log, spinner } from "../ui.js"

interface ScopeOptions {
  system?: boolean
}

interface StartOptions extends ScopeOptions {
  boot: boolean
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function resolveScope(opts: ScopeOptions): ServiceScope {
  return opts.system ? "system" : "user"
}

function addScopeOption(command: Command): Command {
  return command.option(
    "--system",
    "manage a system-wide service instead of a per-user one (Linux/systemd only)",
  )
}

export function registerServiceCommands(program: Command): void {
  addScopeOption(
    program
      .command("start")
      .description("Install (if needed) and start the gentic worker as a background service")
      .option("--no-boot", "do not start the service automatically on boot/login"),
  ).action(async (opts: StartOptions) => {
    const backend = getServiceBackend({ scope: resolveScope(opts) })
    const s = spinner()
    s.start(`Starting gentic (${backend.name})`)
    try {
      await backend.install({ enableOnBoot: opts.boot })
      await backend.start()
      s.stop("gentic is running")

      if (backend.name === "fallback") {
        log.warn(
          "No native service manager was found, so gentic is running as a detached " +
            "process. It will not restart automatically on crash or survive a reboot.",
        )
      } else if (!opts.boot) {
        log.warn("--no-boot was set: the service will not start automatically after a reboot.")
      }
    } catch (error) {
      s.stop("Failed to start gentic")
      log.error(describe(error))
      process.exitCode = 1
    }
  })

  addScopeOption(program.command("stop").description("Stop the gentic background service")).action(
    async (opts: ScopeOptions) => {
      const backend = getServiceBackend({ scope: resolveScope(opts) })
      const s = spinner()
      s.start(`Stopping gentic (${backend.name})`)
      try {
        await backend.stop()
        s.stop("gentic is stopped")
      } catch (error) {
        s.stop("Failed to stop gentic")
        log.error(describe(error))
        process.exitCode = 1
      }
    },
  )

  addScopeOption(program.command("restart").description("Restart the gentic background service")).action(
    async (opts: ScopeOptions) => {
      const backend = getServiceBackend({ scope: resolveScope(opts) })
      const s = spinner()
      s.start(`Restarting gentic (${backend.name})`)
      try {
        await backend.restart()
        s.stop("gentic is running")
      } catch (error) {
        s.stop("Failed to restart gentic")
        log.error(describe(error))
        process.exitCode = 1
      }
    },
  )
}
