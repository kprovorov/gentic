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
  // GENTIC_CONFIG_DIR is an explicit, call-time override for the config
  // directory. It exists primarily so tests can redirect reads/writes to a
  // temp dir: `env-paths` ignores XDG_CONFIG_HOME on macOS (and resolves its
  // paths once at import time), so an env var it honors at call time is the
  // only cross-platform way to keep tests off the real host config file.
  const override = process.env.GENTIC_CONFIG_DIR
  const configDir = override ?? envPaths("gentic", { suffix: "" }).config
  return join(configDir, "config.json")
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
