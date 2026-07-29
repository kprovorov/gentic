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
  return (
    command === "auth" ||
    command === "worker" ||
    command === "onboard" ||
    command === "status" ||
    command === "doctor"
  )
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
    const { runOnboarding } = await import("./onboarding.js")
    await (deps.runOnboarding ?? runOnboarding)()
    const nextStatus = await getStatus()
    exit(nextStatus.ready ? 0 : 1)
  }

  const message = [
    "Gentic onboarding is required before running this command.",
    "Generate a worker code in Gentic, then run:",
    "  gentic worker connect <code>",
    "Resume interrupted local setup with:",
    "  gentic onboard",
    "",
    ...formatOnboardingUnmet(status),
  ].join("\n")

  if (deps.stderr) {
    deps.stderr.write(`${message}\n`)
  } else {
    log.error("Gentic onboarding is required before running this command.")
    note(
      [
        "Generate a worker code in Gentic, then run:",
        "  gentic worker connect <code>",
        "Resume interrupted local setup with:",
        "  gentic onboard",
        "",
        ...formatOnboardingUnmet(status),
      ].join("\n"),
      "Unmet requirements"
    )
  }
  exit(1)
}
