import "dotenv/config"

import { Command } from "commander"

import packageJson from "../package.json" with { type: "json" }
import { registerRunCommand } from "./commands/run.js"
import { logError } from "./log.js"

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const program = new Command()

program
  .name("gentic")
  .description("Run and manage Gentic coding agents")
  .version(packageJson.version ?? "0.0.0")

registerRunCommand(program)

program.parseAsync(process.argv).catch((error: unknown) => {
  logError("fatal:", describe(error))
  process.exit(1)
})
