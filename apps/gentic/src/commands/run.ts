import type { Command } from "commander"

import { runHost } from "../host.js"

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("Run the Gentic host in the foreground")
    .action(async () => {
      await runHost()
    })
}
