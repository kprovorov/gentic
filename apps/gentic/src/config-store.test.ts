import assert from "node:assert/strict"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, test } from "node:test"

let configDir: string

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "gentic-config-test-"))
  process.env.GENTIC_CONFIG_DIR = configDir
})

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true })
  delete process.env.GENTIC_CONFIG_DIR
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
  writeConfigFile({ GENTIC_HOST_CREDENTIAL: "secret", POLL_INTERVAL_MS: 5000 })
  assert.deepEqual(readConfigFile(), {
    GENTIC_HOST_CREDENTIAL: "secret",
    POLL_INTERVAL_MS: 5000,
  })
})

test("writeConfigFile merges rather than clobbers unrelated keys", async () => {
  const { writeConfigFile, readConfigFile } = await freshConfigStore()
  writeConfigFile({ GENTIC_HOST_CREDENTIAL: "secret" })
  writeConfigFile({ WORKDIR: "/custom/workdir" })
  assert.deepEqual(readConfigFile(), {
    GENTIC_HOST_CREDENTIAL: "secret",
    WORKDIR: "/custom/workdir",
  })
})

test("writeConfigFile creates the file with mode 0o600", async () => {
  const { writeConfigFile, configFilePath } = await freshConfigStore()
  writeConfigFile({ GENTIC_HOST_CREDENTIAL: "secret" })
  const mode = statSync(configFilePath()).mode & 0o777
  assert.equal(mode, 0o600)
})

test("clearConfigFile removes the file", async () => {
  const { writeConfigFile, clearConfigFile, configFilePath } = await freshConfigStore()
  writeConfigFile({ GENTIC_HOST_CREDENTIAL: "secret" })
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

test("readConfigFile adopts the pre-rename GENTIC_WORKER_* keys", async () => {
  const { readConfigFile, configFilePath } = await freshConfigStore()
  mkdirSync(configDir, { recursive: true })
  // Exactly what a 0.25.x CLI left on disk. The credential is only recoverable
  // from this file, so failing to read it would force a manual re-enrollment.
  writeFileSync(
    configFilePath(),
    JSON.stringify({
      GENTIC_WORKER_ID: "host-1",
      GENTIC_WORKER_CREDENTIAL: "gtwc_secret",
      GENTIC_WORKER_SETUP_STATE: "ready",
      GENTIC_API_URL: "https://app.gentic.chat/api/v1",
    })
  )

  assert.deepEqual(readConfigFile(), {
    GENTIC_HOST_ID: "host-1",
    GENTIC_HOST_CREDENTIAL: "gtwc_secret",
    GENTIC_HOST_SETUP_STATE: "ready",
    GENTIC_API_URL: "https://app.gentic.chat/api/v1",
  })
})

test("a current key wins over its pre-rename counterpart", async () => {
  const { readConfigFile, configFilePath } = await freshConfigStore()
  mkdirSync(configDir, { recursive: true })
  writeFileSync(
    configFilePath(),
    JSON.stringify({
      GENTIC_WORKER_ID: "stale",
      GENTIC_HOST_ID: "current",
    })
  )

  assert.deepEqual(readConfigFile(), { GENTIC_HOST_ID: "current" })
})

test("the next write drops the pre-rename keys from the file", async () => {
  const { writeConfigFile, configFilePath } = await freshConfigStore()
  mkdirSync(configDir, { recursive: true })
  writeFileSync(
    configFilePath(),
    JSON.stringify({
      GENTIC_WORKER_ID: "host-1",
      GENTIC_WORKER_CREDENTIAL: "gtwc_secret",
    })
  )

  writeConfigFile({ POLL_INTERVAL_MS: 5000 })

  assert.deepEqual(JSON.parse(readFileSync(configFilePath(), "utf8")), {
    GENTIC_HOST_ID: "host-1",
    GENTIC_HOST_CREDENTIAL: "gtwc_secret",
    POLL_INTERVAL_MS: 5000,
  })
})
