import type { Command } from "commander"

import { runWorker } from "../worker.js"

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("Run the Gentic worker in the foreground")
    .action(async () => {
      await runWorker()
    })
}
