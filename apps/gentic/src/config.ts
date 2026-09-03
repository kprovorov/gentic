import { join } from "node:path"

import envPaths from "env-paths"
import { z } from "zod"

import { readConfigFile, type ConfigFile } from "./config-store.js"

const paths = envPaths("gentic", { suffix: "" })

const configSchema = z.object({
  GENTIC_HOST_ID: z.string().min(1),
  GENTIC_HOST_CREDENTIAL: z.string().min(1),
  GENTIC_API_URL: z.string().url(),
  GENTIC_HOST_SETUP_STATE: z
    .enum(["setup-incomplete", "ready"])
    .default("ready"),
  GIT_REMOTE_BASE: z.string().default("git@github.com:"),
  WORKDIR: z.string().default(join(paths.data, "workspaces")),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  MAX_CONCURRENT_ISSUES: z.coerce.number().int().positive().default(1),
})

export type Config = z.infer<typeof configSchema>

export const CONFIG_KEYS = [
  "GENTIC_HOST_ID",
  "GENTIC_HOST_CREDENTIAL",
  "GENTIC_API_URL",
  "GENTIC_HOST_SETUP_STATE",
  "GIT_REMOTE_BASE",
  "WORKDIR",
  "POLL_INTERVAL_MS",
  "MAX_CONCURRENT_ISSUES",
] as const satisfies readonly (keyof ConfigFile)[]

/**
 * Pre-GEN-435 names for the three host keys, still honored so an existing
 * `.env` or service environment keeps working after the rename. The current
 * name wins when both are set. See `LEGACY_CONFIG_KEYS` in `config-store.ts`
 * for the same treatment of the persisted config file.
 */
const LEGACY_ENV_KEYS: Partial<Record<(typeof CONFIG_KEYS)[number], string>> = {
  GENTIC_HOST_ID: "GENTIC_WORKER_ID",
  GENTIC_HOST_CREDENTIAL: "GENTIC_WORKER_CREDENTIAL",
  GENTIC_HOST_SETUP_STATE: "GENTIC_WORKER_SETUP_STATE",
}

function pickPresentEnvKeys(env: NodeJS.ProcessEnv): Partial<ConfigFile> {
  const present: Partial<Record<string, string>> = {}
  for (const key of CONFIG_KEYS) {
    const legacyKey = LEGACY_ENV_KEYS[key]
    // A blank env var (e.g. an uncommented `GENTIC_HOST_ID=` placeholder
    // left over from .env.example) must not clobber a real, persisted
    // config-file value — treat "" the same as unset.
    const value =
      env[key] !== undefined && env[key] !== ""
        ? env[key]
        : legacyKey && env[legacyKey] !== ""
          ? env[legacyKey]
          : undefined
    if (value !== undefined) {
      present[key] = value
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
    !merged.GENTIC_HOST_ID ||
    !merged.GENTIC_HOST_CREDENTIAL ||
    !merged.GENTIC_API_URL
  ) {
    throw new Error(
      "No Gentic host is connected. Run `gentic host connect <code>`."
    )
  }

  return configSchema.parse(merged)
}
