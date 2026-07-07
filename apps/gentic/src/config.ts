import { join } from "node:path"

import envPaths from "env-paths"
import { z } from "zod"

import { readConfigFile, type ConfigFile } from "./config-store.js"

const paths = envPaths("gentic", { suffix: "" })

const configSchema = z.object({
  GENTIC_API_KEY: z.string().min(1),
  GENTIC_API_URL: z.string().url(),
  GIT_REMOTE_BASE: z.string().default("git@github.com:"),
  WORKDIR: z.string().default(join(paths.data, "workspaces")),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
})

export type Config = z.infer<typeof configSchema>

const CONFIG_KEYS = [
  "GENTIC_API_KEY",
  "GENTIC_API_URL",
  "GIT_REMOTE_BASE",
  "WORKDIR",
  "POLL_INTERVAL_MS",
] as const satisfies readonly (keyof ConfigFile)[]

function pickPresentEnvKeys(env: NodeJS.ProcessEnv): Partial<ConfigFile> {
  const present: Partial<Record<string, string>> = {}
  for (const key of CONFIG_KEYS) {
    if (env[key] !== undefined) {
      present[key] = env[key]
    }
  }
  return present
}

export function loadConfig(): Config {
  const configFile = readConfigFile()
  const envOverrides = pickPresentEnvKeys(process.env)
  const merged = { ...configFile, ...envOverrides }

  if (!merged.GENTIC_API_KEY || !merged.GENTIC_API_URL) {
    throw new Error(
      "Not authenticated. Run `gentic auth login` or set GENTIC_API_KEY and GENTIC_API_URL.",
    )
  }

  return configSchema.parse(merged)
}
