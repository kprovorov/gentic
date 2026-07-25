import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, afterEach, beforeEach, test } from "node:test"

import type { OnboardingStatus } from "./onboarding.js"

const CONFIG_KEYS = [
  "GENTIC_API_KEY",
  "GENTIC_API_URL",
] as const

const configDir = mkdtempSync(join(tmpdir(), "gentic-gate-config-test-"))
process.env.XDG_CONFIG_HOME = configDir

const { checkOnboardingGate } = await import("./cli-gate.js")
const { getConfigInput } = await import("./config.js")
const { clearConfigFile, writeConfigFile } = await import("./config-store.js")
const { getOnboardingStatus } = await import("./onboarding.js")

let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  savedEnv = Object.fromEntries(
    CONFIG_KEYS.map((key) => [key, process.env[key]])
  )
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

async function gateStatus(): Promise<OnboardingStatus> {
  return getOnboardingStatus({
    configInput: getConfigInput(),
    getTools: async () => ({
      github: { installed: true, authenticated: true, version: "2.74.2" },
      claude: { installed: true, authenticated: true, version: "1.0.0" },
      codex: { installed: true, authenticated: true, version: "1.2.3" },
    }),
  })
}

test("checkOnboardingGate is satisfied by credentials in the config file", async () => {
  writeConfigFile({
    GENTIC_API_KEY: "file-key",
    GENTIC_API_URL: "https://file.example.com",
  })

  await checkOnboardingGate({
    argv: ["node", "gentic", "run"],
    getStatus: gateStatus,
    exit: () => {
      throw new Error("exit should not be called")
    },
  })
})

test("checkOnboardingGate is satisfied by credentials in env vars", async () => {
  process.env.GENTIC_API_KEY = "env-key"
  process.env.GENTIC_API_URL = "https://env.example.com"

  await checkOnboardingGate({
    argv: ["node", "gentic", "run"],
    getStatus: gateStatus,
    exit: () => {
      throw new Error("exit should not be called")
    },
  })
})

test("checkOnboardingGate fast-fails for non-TTY stdin when credentials are absent", async () => {
  let output = ""

  await assert.rejects(
    checkOnboardingGate({
      argv: ["node", "gentic", "run"],
      stdin: { isTTY: false },
      stderr: {
        write(chunk: string | Uint8Array): boolean {
          output += String(chunk)
          return true
        },
      },
      getStatus: gateStatus,
      exit: (code?: number): never => {
        throw new Error(`exit:${code}`)
      },
    }),
    /exit:1/
  )

  assert.match(output, /Gentic onboarding is required/)
  assert.match(output, /missing GENTIC_API_KEY and GENTIC_API_URL/)
})
