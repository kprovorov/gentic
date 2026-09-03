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
  GENTIC_HOST_ID?: string
  GENTIC_HOST_CREDENTIAL?: string
  GENTIC_API_URL?: string
  GENTIC_HOST_SETUP_STATE?: "setup-incomplete" | "ready"
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

/**
 * Config keys written by CLIs from before hosts were renamed from "workers"
 * (GEN-435), mapped to the key that replaced them. Every already-connected
 * machine has one of these files on disk, and the registration it holds is not
 * re-derivable —
 * the credential is stored hashed server-side and the enrollment code that
 * minted it was single-use. Reading the old keys is what makes upgrading the
 * CLI an upgrade rather than a re-enrollment.
 *
 * `writeConfigFile` drops them on the next write, so a file converts itself the
 * first time anything touches it.
 */
const LEGACY_CONFIG_KEYS = {
  GENTIC_WORKER_ID: "GENTIC_HOST_ID",
  GENTIC_WORKER_CREDENTIAL: "GENTIC_HOST_CREDENTIAL",
  GENTIC_WORKER_SETUP_STATE: "GENTIC_HOST_SETUP_STATE",
} as const satisfies Record<string, keyof ConfigFile>

export function readConfigFile(): ConfigFile {
  let raw: string
  try {
    raw = readFileSync(configFilePath(), "utf8")
  } catch {
    return {}
  }

  const parsed = JSON.parse(raw) as Record<string, unknown>

  for (const [legacyKey, currentKey] of Object.entries(LEGACY_CONFIG_KEYS)) {
    // A current key already on the file wins: it is what the running CLI wrote.
    if (parsed[currentKey] === undefined && parsed[legacyKey] !== undefined) {
      parsed[currentKey] = parsed[legacyKey]
    }
    delete parsed[legacyKey]
  }

  return parsed as ConfigFile
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
