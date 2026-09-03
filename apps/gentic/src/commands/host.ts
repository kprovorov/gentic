import type { Command } from "commander"

import { configFilePath } from "../config-store.js"
import {
  connectHostWithCode,
  DEFAULT_API_URL,
  type ConnectHostDeps,
} from "../enrollment.js"
import { runOnboarding } from "../onboarding.js"
import { log } from "../ui.js"

interface HostConnectOptions {
  apiUrl?: string
  noOnboard?: boolean
}

export async function connectHost(
  code: string,
  opts: HostConnectOptions = {},
  deps: ConnectHostDeps = {}
): Promise<void> {
  const enrollment = await connectHostWithCode(
    code,
    { apiUrl: opts.apiUrl ?? DEFAULT_API_URL },
    deps
  )

  log.success(
    `Connected host ${enrollment.hostId}${
      enrollment.displayName ? ` (${enrollment.displayName})` : ""
    }.`
  )
  log.info(`Saved registration to ${configFilePath()}.`)

  if (opts.noOnboard) {
    log.info("Run `gentic onboard` to finish GitHub, Codex, and Claude Code setup.")
    return
  }

  await runOnboarding()
}

function registerConnectSubcommand(parent: Command): void {
  parent
    .command("connect")
    .description("Connect this machine with a Gentic host enrollment code")
    .argument("<code>", "host enrollment code")
    .option("--api-url <url>", "Gentic API URL", DEFAULT_API_URL)
    .option("--no-onboard", "save the registration without running onboarding")
    .action(async (code: string, opts: HostConnectOptions) => {
      await connectHost(code, opts)
    })
}

export function registerHostCommand(program: Command): void {
  registerConnectSubcommand(
    program.command("host").description("Manage this Gentic host")
  )

  // `gentic worker connect` is what every pre-GEN-435 doc, blog post and
  // muscle memory says. Keep it working so the rename costs a user nothing,
  // but hide it from `--help` so the CLI only ever teaches "host".
  registerConnectSubcommand(
    program
      .command("worker", { hidden: true })
      .description("Deprecated alias for `gentic host`")
  )
}
