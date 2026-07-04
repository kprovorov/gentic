import "dotenv/config"

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { Command } from "commander"

import { registerRunCommand } from "./commands/run.js"

function readPackageVersion(): string {
  const cliDir = dirname(fileURLToPath(import.meta.url))
  const packageJsonPath = join(cliDir, "../package.json")
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    version?: string
  }

  return packageJson.version ?? "0.0.0"
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const program = new Command()

program
  .name("gentic")
  .description("Run and manage Gentic coding agents")
  .version(readPackageVersion())

registerRunCommand(program)

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error("[gentic] fatal:", describe(error))
  process.exit(1)
})
