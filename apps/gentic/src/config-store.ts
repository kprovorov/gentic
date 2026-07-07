import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import envPaths from "env-paths"

export interface ConfigFile {
  GENTIC_API_KEY?: string
  GENTIC_API_URL?: string
  GIT_REMOTE_BASE?: string
  WORKDIR?: string
  POLL_INTERVAL_MS?: number
}

const paths = envPaths("gentic", { suffix: "" })

export function configFilePath(): string {
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
  const filePath = configFilePath()
  const tmpPath = `${filePath}.tmp`

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(tmpPath, JSON.stringify(merged, null, 2), { mode: 0o600 })
  renameSync(tmpPath, filePath)
}

export function clearConfigFile(): void {
  rmSync(configFilePath(), { force: true })
}
