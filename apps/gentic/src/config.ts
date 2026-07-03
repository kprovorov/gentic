import { z } from "zod"

const configSchema = z.object({
  GENTIC_API_KEY: z.string().min(1),
  GENTIC_API_URL: z.string().url(),
  GIT_REMOTE_BASE: z.string().default("git@github.com:"),
  WORKDIR: z.string().default("/tmp/gentic-workspaces"),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
})

export type Config = z.infer<typeof configSchema>

export function loadConfig(): Config {
  return configSchema.parse(process.env)
}
