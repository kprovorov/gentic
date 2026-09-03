import assert from "node:assert/strict"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, test } from "node:test"

import type { ToolStatuses } from "./tools.js"

let configDir: string

const tools: ToolStatuses = {
  github: { installed: true, authenticated: true, version: "2.0.0" },
  claude: { installed: true, authenticated: true, version: "1.0.0" },
  codex: { installed: true, authenticated: true, version: "0.1.0" },
}

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "gentic-enrollment-test-"))
  process.env.GENTIC_CONFIG_DIR = configDir
})

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true })
  delete process.env.GENTIC_CONFIG_DIR
})

async function freshModules() {
  const tag = `${Date.now()}-${Math.random()}`
  const enrollment = await import(`./enrollment.js?t=${tag}`)
  const configStore = await import(`./config-store.js?t=${tag}`)
  return { enrollment, configStore }
}

test("connectHostWithCode exchanges code and persists stable host identity", async () => {
  const { enrollment, configStore } = await freshModules()
  let requestBody: unknown

  const result = await enrollment.connectHostWithCode(
    "gtce_valid-connection-code",
    { apiUrl: "https://app.example/api/v1" },
    {
      hostname: () => "build-host-1",
      getTools: async () => tools,
      fetch: async (_url: string | URL | Request, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body))
        return Response.json({
          extra_field: "ignored",
          api_url: "https://tenant.example/api/v1",
          host: {
            id: "host-123",
            display_name: "build-host-1",
            setup_state: "enrolling",
            extra_host_field: "ignored",
          },
          credential: "gtwc_abcdefghijklmnopqrstuvwxyzABCDEFGH",
        })
      },
    }
  )

  assert.equal(result.apiUrl, "https://tenant.example/api/v1")
  assert.equal(result.hostId, "host-123")
  assert.deepEqual(configStore.readConfigFile(), {
    GENTIC_API_URL: "https://tenant.example/api/v1",
    GENTIC_HOST_ID: "host-123",
    GENTIC_HOST_CREDENTIAL: "gtwc_abcdefghijklmnopqrstuvwxyzABCDEFGH",
    GENTIC_HOST_SETUP_STATE: "setup-incomplete",
  })
  assert.equal(statSync(configStore.configFilePath()).mode & 0o777, 0o600)
  assert.equal((requestBody as { display_name: string }).display_name, "build-host-1")
})

test("connectHostWithCode reports invalid or expired codes without persisting", async () => {
  const { enrollment, configStore } = await freshModules()

  await assert.rejects(
    enrollment.connectHostWithCode(
      "gtce_expired-connection-code",
      { apiUrl: "https://app.example/api/v1" },
      {
        getTools: async () => tools,
        fetch: async () =>
          Response.json({ error: "Invalid enrollment code" }, { status: 400 }),
      }
    ),
    /Invalid or expired host connection code/
  )

  assert.deepEqual(configStore.readConfigFile(), {})
})

test("markHostSetupReady persists completion after API acknowledgement", async () => {
  const { enrollment, configStore } = await freshModules()
  configStore.writeConfigFile({
    GENTIC_API_URL: "https://app.example/api/v1",
    GENTIC_HOST_ID: "host-123",
    GENTIC_HOST_CREDENTIAL: "gtwc_abcdefghijklmnopqrstuvwxyzABCDEFGH",
    GENTIC_HOST_SETUP_STATE: "setup-incomplete",
  })

  await enrollment.markHostSetupReady({
    fetch: async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(url, "https://app.example/api/v1/agent/host/setup")
      assert.equal(
        (init?.headers as Record<string, string>).authorization,
        "Bearer gtwc_abcdefghijklmnopqrstuvwxyzABCDEFGH"
      )
      assert.deepEqual(JSON.parse(String(init?.body)), { setup_state: "ready" })
      return Response.json({ host: { id: "host-123", setup_state: "ready" } })
    },
  })

  assert.equal(configStore.readConfigFile().GENTIC_HOST_SETUP_STATE, "ready")
})

test("markHostSetupReady keeps setup incomplete when API update fails", async () => {
  const { enrollment, configStore } = await freshModules()
  configStore.writeConfigFile({
    GENTIC_API_URL: "https://app.example/api/v1",
    GENTIC_HOST_ID: "host-123",
    GENTIC_HOST_CREDENTIAL: "gtwc_abcdefghijklmnopqrstuvwxyzABCDEFGH",
    GENTIC_HOST_SETUP_STATE: "setup-incomplete",
  })

  await assert.rejects(
    enrollment.markHostSetupReady({
      fetch: async () =>
        Response.json({ error: "service unavailable" }, { status: 503 }),
    }),
    /service unavailable/
  )

  assert.equal(
    configStore.readConfigFile().GENTIC_HOST_SETUP_STATE,
    "setup-incomplete"
  )
})

test("markHostSetupReady logs missing config before returning", async () => {
  const { enrollment } = await freshModules()
  const originalError = console.error
  const messages: string[] = []
  console.error = (...args: unknown[]) => {
    messages.push(args.map(String).join(" "))
  }
  try {
    await enrollment.markHostSetupReady()
  } finally {
    console.error = originalError
  }

  assert.ok(
    messages.some(
      (message) =>
        message.includes("cannot mark host setup ready") &&
        message.includes("GENTIC_API_URL") &&
        message.includes("GENTIC_HOST_CREDENTIAL") &&
        message.includes("GENTIC_HOST_ID")
    )
  )
})
