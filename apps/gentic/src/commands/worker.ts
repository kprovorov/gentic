import type { Command } from "commander"

import { configFilePath } from "../config-store.js"
import {
  connectWorkerWithCode,
  DEFAULT_API_URL,
  type ConnectWorkerDeps,
} from "../enrollment.js"
import { runOnboarding } from "../onboarding.js"
import { log } from "../ui.js"

interface WorkerConnectOptions {
  apiUrl?: string
  noOnboard?: boolean
}

export async function connectWorker(
  code: string,
  opts: WorkerConnectOptions = {},
  deps: ConnectWorkerDeps = {}
): Promise<void> {
  const enrollment = await connectWorkerWithCode(
    code,
    { apiUrl: opts.apiUrl ?? DEFAULT_API_URL },
    deps
  )

  log.success(
    `Connected worker ${enrollment.workerId}${
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

export function registerWorkerCommand(program: Command): void {
  const worker = program.command("worker").description("Manage this Gentic worker")

  worker
    .command("connect")
    .description("Connect this machine with a Gentic worker enrollment code")
    .argument("<code>", "worker enrollment code")
    .option("--api-url <url>", "Gentic API URL", DEFAULT_API_URL)
    .option("--no-onboard", "save the registration without running onboarding")
    .action(async (code: string, opts: WorkerConnectOptions) => {
      await connectWorker(code, opts)
    })
}
