import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, test } from "node:test"

let configDir: string

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "gentic-config-test-"))
  process.env.XDG_CONFIG_HOME = configDir
})

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true })
  delete process.env.XDG_CONFIG_HOME
})

async function freshConfigStore() {
  return import(`./config-store.js?t=${Date.now()}-${Math.random()}`)
}

test("readConfigFile returns {} when the file does not exist", async () => {
  const { readConfigFile } = await freshConfigStore()
  assert.deepEqual(readConfigFile(), {})
})

test("writeConfigFile then readConfigFile round-trips", async () => {
  const { writeConfigFile, readConfigFile } = await freshConfigStore()
  writeConfigFile({ GENTIC_API_KEY: "secret", POLL_INTERVAL_MS: 5000 })
  assert.deepEqual(readConfigFile(), {
    GENTIC_API_KEY: "secret",
    POLL_INTERVAL_MS: 5000,
  })
})

test("writeConfigFile merges rather than clobbers unrelated keys", async () => {
  const { writeConfigFile, readConfigFile } = await freshConfigStore()
  writeConfigFile({ GENTIC_API_KEY: "secret" })
  writeConfigFile({ WORKDIR: "/custom/workdir" })
  assert.deepEqual(readConfigFile(), {
    GENTIC_API_KEY: "secret",
    WORKDIR: "/custom/workdir",
  })
})

test("writeConfigFile creates the file with mode 0o600", async () => {
  const { writeConfigFile, configFilePath } = await freshConfigStore()
  writeConfigFile({ GENTIC_API_KEY: "secret" })
  const mode = statSync(configFilePath()).mode & 0o777
  assert.equal(mode, 0o600)
})

test("clearConfigFile removes the file", async () => {
  const { writeConfigFile, clearConfigFile, configFilePath } = await freshConfigStore()
  writeConfigFile({ GENTIC_API_KEY: "secret" })
  assert.ok(existsSync(configFilePath()))
  clearConfigFile()
  assert.ok(!existsSync(configFilePath()))
})

test("clearConfigFile on a missing file does not throw", async () => {
  const { clearConfigFile } = await freshConfigStore()
  assert.doesNotThrow(() => {
    clearConfigFile()
  })
})
