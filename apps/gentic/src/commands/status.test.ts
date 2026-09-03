import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

import type { ServiceBackend } from "../service/index.js"
import type { ToolStatuses } from "../tools.js"

const configDir = mkdtempSync(join(tmpdir(), "gentic-status-test-"))
process.env.GENTIC_CONFIG_DIR = configDir

const { configFilePath } = await import("../config-store.js")
const { status } = await import("./status.js")

after(() => {
  delete process.env.GENTIC_CONFIG_DIR
  rmSync(configDir, { recursive: true, force: true })
})

const tools: ToolStatuses = {
  github: { installed: true, authenticated: true, version: "2.74.2" },
}

async function captureJsonOutput(run: () => Promise<void>): Promise<unknown> {
  const originalLog = console.log
  let output = ""
  console.log = (value?: unknown) => {
    output += String(value)
  }

  try {
    await run()
  } finally {
    console.log = originalLog
  }

  return JSON.parse(output) as unknown
}

test("status JSON includes config file location when host is not connected", async () => {
  const output = await captureJsonOutput(() =>
    status(
      { json: true },
      {
        getAuthState: () => ({ authenticated: false }),
        getToolStatuses: async () => tools,
      }
    )
  )

  assert.deepEqual(output, {
    host: "not-connected",
    configFile: configFilePath(),
    tools: {
      github: { installed: true, authenticated: true, version: "2.74.2" },
    },
  })
})

test("status JSON includes config file location when host is connected", async () => {
  const backend: ServiceBackend = {
    name: "test",
    isAvailable: () => true,
    install: async () => {},
    uninstall: async () => {},
    start: async () => {},
    stop: async () => {},
    reload: async () => {},
    restart: async () => {},
    status: async () => ({ state: "not-installed" }),
    isEnabledOnBoot: async () => false,
    logs: async () => {},
  }

  const output = await captureJsonOutput(() =>
    status(
      { json: true },
      {
        getAuthState: () => ({
          authenticated: true,
          hostId: "host-1",
          apiUrl: "https://api.example.com",
          maskedHostCredential: "abc...1234",
          setupState: "ready",
        }),
        getToolStatuses: async () => tools,
        getServiceBackend: () => backend,
      }
    )
  )

  assert.equal((output as { configFile?: string }).configFile, configFilePath())
})
