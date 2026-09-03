import "dotenv/config"

import { Command } from "commander"

import packageJson from "../package.json" with { type: "json" }
import { registerAuthCommand } from "./commands/auth.js"
import { registerLogsCommand } from "./commands/logs.js"
import { registerRunCommand } from "./commands/run.js"
import { registerServiceCommands } from "./commands/service.js"
import { registerStatusCommand } from "./commands/status.js"
import { registerHostCommand } from "./commands/host.js"
import { checkOnboardingGate } from "./cli-gate.js"
import { logError } from "./log.js"
import {
  formatOnboardingUnmet,
  getOnboardingStatus,
  runOnboarding,
} from "./onboarding.js"
import { log, note } from "./ui.js"

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const program = new Command()

program
  .name("gentic")
  .description("Run and manage Gentic coding agents")
  .version(packageJson.version ?? "0.0.0")

registerAuthCommand(program)
registerLogsCommand(program)
registerRunCommand(program)
registerServiceCommands(program)
registerStatusCommand(program)
registerHostCommand(program)

program
  .command("onboard")
  .description("Resume local GitHub, Codex, and Claude Code onboarding")
  .action(async () => {
    await runOnboarding()
  })

program
  .command("doctor")
  .description("Check Gentic credentials and required local tools")
  .option("--json", "output machine-readable JSON instead of styled text")
  .action(async (opts: { json?: boolean }) => {
    const status = await getOnboardingStatus()
    if (opts.json) {
      console.log(JSON.stringify(status))
      return
    }

    if (status.ready) {
      log.success("Gentic is ready to run issues.")
      return
    }

    note(formatOnboardingUnmet(status).join("\n"), "Unmet requirements")
    process.exitCode = 1
  })

checkOnboardingGate()
  .then(() => program.parseAsync(process.argv))
  .catch((error: unknown) => {
    logError("fatal:", describe(error))
    process.exit(1)
  })
