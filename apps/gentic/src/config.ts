import { join } from "node:path"

import envPaths from "env-paths"
import { z } from "zod"

import { readConfigFile, type ConfigFile } from "./config-store.js"

const paths = envPaths("gentic", { suffix: "" })

const configSchema = z.object({
  GENTIC_WORKER_ID: z.string().min(1),
  GENTIC_WORKER_CREDENTIAL: z.string().min(1),
  GENTIC_API_URL: z.string().url(),
  GENTIC_WORKER_SETUP_STATE: z
    .enum(["setup-incomplete", "ready"])
    .default("ready"),
  GIT_REMOTE_BASE: z.string().default("git@github.com:"),
  WORKDIR: z.string().default(join(paths.data, "workspaces")),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  MAX_CONCURRENT_ISSUES: z.coerce.number().int().positive().default(1),
})

export type Config = z.infer<typeof configSchema>

export const CONFIG_KEYS = [
  "GENTIC_WORKER_ID",
  "GENTIC_WORKER_CREDENTIAL",
  "GENTIC_API_URL",
  "GENTIC_WORKER_SETUP_STATE",
  "GIT_REMOTE_BASE",
  "WORKDIR",
  "POLL_INTERVAL_MS",
  "MAX_CONCURRENT_ISSUES",
] as const satisfies readonly (keyof ConfigFile)[]

function pickPresentEnvKeys(env: NodeJS.ProcessEnv): Partial<ConfigFile> {
  const present: Partial<Record<string, string>> = {}
  for (const key of CONFIG_KEYS) {
    // A blank env var (e.g. an uncommented `GENTIC_WORKER_ID=` placeholder
    // left over from .env.example) must not clobber a real, persisted
    // config-file value — treat "" the same as unset.
    if (env[key] !== undefined && env[key] !== "") {
      present[key] = env[key]
    }
  }
  return present
}

export function getConfigInput(
  env: NodeJS.ProcessEnv = process.env
): Partial<ConfigFile> {
  const configFile = readConfigFile()
  const envOverrides = pickPresentEnvKeys(env)
  return { ...configFile, ...envOverrides }
}

export function loadConfig(): Config {
  const merged = getConfigInput()

  if (
    !merged.GENTIC_WORKER_ID ||
    !merged.GENTIC_WORKER_CREDENTIAL ||
    !merged.GENTIC_API_URL
  ) {
    throw new Error(
      "No Gentic worker is connected. Run `gentic worker connect <code>`."
    )
  }

  return configSchema.parse(merged)
}
