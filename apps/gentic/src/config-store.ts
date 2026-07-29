import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"

import envPaths from "env-paths"

export interface ConfigFile {
  GENTIC_WORKER_ID?: string
  GENTIC_WORKER_CREDENTIAL?: string
  GENTIC_API_URL?: string
  GENTIC_WORKER_SETUP_STATE?: "setup-incomplete" | "ready"
  GIT_REMOTE_BASE?: string
  WORKDIR?: string
  POLL_INTERVAL_MS?: number
  MAX_CONCURRENT_ISSUES?: number
}

export function configFilePath(): string {
  const paths = envPaths("gentic", { suffix: "" })
  return join(paths.config, "config.json")
}

export function readConfigFile(): ConfigFile {
  let raw: string
  try {
    raw = readFileSync(configFilePath(), "utf8")
  } catch {
    return {}
  }

  return JSON.parse(raw) as ConfigFile
}

export function writeConfigFile(patch: Partial<ConfigFile>): void {
  const merged = { ...readConfigFile(), ...patch }
  delete (merged as Record<string, unknown>).AGENT_PROVIDERS
  const filePath = configFilePath()
  const tmpPath = `${filePath}.tmp`

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(tmpPath, JSON.stringify(merged, null, 2), { mode: 0o600 })
  renameSync(tmpPath, filePath)
}

export function clearConfigFile(): void {
  rmSync(configFilePath(), { force: true })
}
