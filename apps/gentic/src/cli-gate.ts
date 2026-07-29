import type { ReadStream, WriteStream } from "node:tty"

import {
  formatOnboardingUnmet,
  getOnboardingStatus,
  type OnboardingStatus,
} from "./onboarding.js"
import { log, note } from "./ui.js"

const HELP_OR_VERSION_FLAGS = new Set(["--help", "-h", "--version", "-V"])

export interface CliGateDeps {
  argv?: string[]
  stdin?: Pick<ReadStream, "isTTY">
  stderr?: Pick<WriteStream, "write">
  getStatus?: () => Promise<OnboardingStatus>
  runOnboarding?: () => Promise<void>
  exit?: (code?: number) => never
}

export function shouldBypassOnboardingGate(argv: string[]): boolean {
  const args = argv.slice(2)
  if (args.some((arg) => HELP_OR_VERSION_FLAGS.has(arg))) return true

  const command = args.find((arg) => !arg.startsWith("-"))
  return command === "auth"
}

export async function checkOnboardingGate(
  deps: CliGateDeps = {}
): Promise<void> {
  const argv = deps.argv ?? process.argv
  if (shouldBypassOnboardingGate(argv)) return

  const getStatus = deps.getStatus ?? getOnboardingStatus
  const status = await getStatus()
  if (status.ready) return

  const stdin = deps.stdin ?? process.stdin
  const exit = deps.exit ?? process.exit

  if (stdin.isTTY) {
    const { loginInteractive } = await import("./commands/auth.js")
    await (deps.runOnboarding ?? loginInteractive)()
    exit(0)
  }

  const message = [
    "Gentic onboarding is required before running this command.",
    "Set GENTIC_WORKER_CREDENTIAL and GENTIC_API_URL, or run:",
    "  gentic auth login --worker-credential ... --api-url ...",
    "",
    ...formatOnboardingUnmet(status),
  ].join("\n")

  if (deps.stderr) {
    deps.stderr.write(`${message}\n`)
  } else {
    log.error("Gentic onboarding is required before running this command.")
    note(
      [
        "Set GENTIC_WORKER_CREDENTIAL and GENTIC_API_URL, or run:",
        "  gentic auth login --worker-credential ... --api-url ...",
        "",
        ...formatOnboardingUnmet(status),
      ].join("\n"),
      "Unmet requirements"
    )
  }
  exit(1)
}
