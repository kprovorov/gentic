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
  process.env.XDG_CONFIG_HOME = configDir
})

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true })
  delete process.env.XDG_CONFIG_HOME
})

async function freshModules() {
  const tag = `${Date.now()}-${Math.random()}`
  const enrollment = await import(`./enrollment.js?t=${tag}`)
  const configStore = await import(`./config-store.js?t=${tag}`)
  return { enrollment, configStore }
}

test("connectWorkerWithCode exchanges code and persists stable worker identity", async () => {
  const { enrollment, configStore } = await freshModules()
  let requestBody: unknown

  const result = await enrollment.connectWorkerWithCode(
    "gtce_valid-connection-code",
    { apiUrl: "https://app.example/api/v1" },
    {
      hostname: () => "build-host-1",
      getTools: async () => tools,
      fetch: async (_url: string | URL | Request, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body))
        return Response.json({
          api_url: "https://tenant.example/api/v1",
          worker: {
            id: "worker-123",
            display_name: "build-host-1",
            setup_state: "enrolling",
          },
          credential: "gtwc_abcdefghijklmnopqrstuvwxyzABCDEFGH",
        })
      },
    }
  )

  assert.equal(result.apiUrl, "https://tenant.example/api/v1")
  assert.equal(result.workerId, "worker-123")
  assert.deepEqual(configStore.readConfigFile(), {
    GENTIC_API_URL: "https://tenant.example/api/v1",
    GENTIC_WORKER_ID: "worker-123",
    GENTIC_WORKER_CREDENTIAL: "gtwc_abcdefghijklmnopqrstuvwxyzABCDEFGH",
    GENTIC_WORKER_SETUP_STATE: "setup-incomplete",
  })
  assert.equal(statSync(configStore.configFilePath()).mode & 0o777, 0o600)
  assert.equal((requestBody as { display_name: string }).display_name, "build-host-1")
})

test("connectWorkerWithCode reports invalid or expired codes without persisting", async () => {
  const { enrollment, configStore } = await freshModules()

  await assert.rejects(
    enrollment.connectWorkerWithCode(
      "gtce_expired-connection-code",
      { apiUrl: "https://app.example/api/v1" },
      {
        getTools: async () => tools,
        fetch: async () =>
          Response.json({ error: "Invalid enrollment code" }, { status: 400 }),
      }
    ),
    /Invalid or expired worker connection code/
  )

  assert.deepEqual(configStore.readConfigFile(), {})
})

test("markWorkerSetupReady persists completion after API acknowledgement", async () => {
  const { enrollment, configStore } = await freshModules()
  configStore.writeConfigFile({
    GENTIC_API_URL: "https://app.example/api/v1",
    GENTIC_WORKER_ID: "worker-123",
    GENTIC_WORKER_CREDENTIAL: "gtwc_abcdefghijklmnopqrstuvwxyzABCDEFGH",
    GENTIC_WORKER_SETUP_STATE: "setup-incomplete",
  })

  await enrollment.markWorkerSetupReady({
    fetch: async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(url, "https://app.example/api/v1/agent/worker/setup")
      assert.equal(
        (init?.headers as Record<string, string>).authorization,
        "Bearer gtwc_abcdefghijklmnopqrstuvwxyzABCDEFGH"
      )
      assert.deepEqual(JSON.parse(String(init?.body)), { setup_state: "ready" })
      return Response.json({ worker: { id: "worker-123", setup_state: "ready" } })
    },
  })

  assert.equal(configStore.readConfigFile().GENTIC_WORKER_SETUP_STATE, "ready")
})

test("markWorkerSetupReady keeps setup incomplete when API update fails", async () => {
  const { enrollment, configStore } = await freshModules()
  configStore.writeConfigFile({
    GENTIC_API_URL: "https://app.example/api/v1",
    GENTIC_WORKER_ID: "worker-123",
    GENTIC_WORKER_CREDENTIAL: "gtwc_abcdefghijklmnopqrstuvwxyzABCDEFGH",
    GENTIC_WORKER_SETUP_STATE: "setup-incomplete",
  })

  await assert.rejects(
    enrollment.markWorkerSetupReady({
      fetch: async () =>
        Response.json({ error: "service unavailable" }, { status: 503 }),
    }),
    /service unavailable/
  )

  assert.equal(
    configStore.readConfigFile().GENTIC_WORKER_SETUP_STATE,
    "setup-incomplete"
  )
})
