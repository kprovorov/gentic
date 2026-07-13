import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, afterEach, beforeEach, test } from "node:test"

const CONFIG_KEYS = [
  "GENTIC_API_KEY",
  "GENTIC_API_URL",
  "GIT_REMOTE_BASE",
  "WORKDIR",
  "POLL_INTERVAL_MS",
  "MAX_CONCURRENT_ISSUES",
] as const

// `env-paths` resolves the config directory once, at module-evaluation time,
// so XDG_CONFIG_HOME must be set before config-store.ts (and config.ts,
// which imports it) are first evaluated.
const configDir = mkdtempSync(join(tmpdir(), "gentic-config-test-"))
process.env.XDG_CONFIG_HOME = configDir

const { writeConfigFile, clearConfigFile } = await import("./config-store.js")
const { loadConfig } = await import("./config.js")

let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  savedEnv = Object.fromEntries(CONFIG_KEYS.map((key) => [key, process.env[key]]))
  for (const key of CONFIG_KEYS) delete process.env[key]
  clearConfigFile()
})

afterEach(() => {
  for (const key of CONFIG_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

after(() => {
  delete process.env.XDG_CONFIG_HOME
  rmSync(configDir, { recursive: true, force: true })
})

test("loadConfig works with only env vars set (no config file)", () => {
  process.env.GENTIC_API_KEY = "env-key"
  process.env.GENTIC_API_URL = "https://env.example.com"

  const loaded = loadConfig()
  assert.equal(loaded.GENTIC_API_KEY, "env-key")
  assert.equal(loaded.GENTIC_API_URL, "https://env.example.com")
  assert.equal(loaded.GIT_REMOTE_BASE, "git@github.com:")
  assert.equal(loaded.POLL_INTERVAL_MS, 3000)
  assert.equal(loaded.MAX_CONCURRENT_ISSUES, 1)
})

test("loadConfig works with only the config file set", () => {
  writeConfigFile({
    GENTIC_API_KEY: "file-key",
    GENTIC_API_URL: "https://file.example.com",
  })

  const loaded = loadConfig()
  assert.equal(loaded.GENTIC_API_KEY, "file-key")
  assert.equal(loaded.GENTIC_API_URL, "https://file.example.com")
})

test("loadConfig prefers env over the config file for the same key", () => {
  writeConfigFile({
    GENTIC_API_KEY: "file-key",
    GENTIC_API_URL: "https://file.example.com",
  })
  process.env.GENTIC_API_KEY = "env-key"

  const loaded = loadConfig()
  assert.equal(loaded.GENTIC_API_KEY, "env-key")
  assert.equal(loaded.GENTIC_API_URL, "https://file.example.com")
})

test("loadConfig accepts a concurrent-issue limit", () => {
  process.env.GENTIC_API_KEY = "env-key"
  process.env.GENTIC_API_URL = "https://env.example.com"
  process.env.MAX_CONCURRENT_ISSUES = "3"

  assert.equal(loadConfig().MAX_CONCURRENT_ISSUES, 3)
})
