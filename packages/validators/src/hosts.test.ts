import assert from "node:assert/strict"
import { test } from "node:test"

import {
  consumeHostEnrollmentCodeInputSchema,
  createHostEnrollmentCodeInputSchema,
  renameHostInputSchema,
  updateHostManagementInputSchema,
  hostLifecycleOperationInputSchema,
  hostCapabilitiesSchema,
  hostHeartbeatTelemetrySchema,
  hostLifecycleEventSchema,
  hostLifecycleStateSchema,
  hostNormalizedNameSchema,
  hostSetupStateSchema,
} from "./hosts.js"

const hostId = "8f14e45f-ceea-467e-b7ea-05a3e2b3f4c1"
const now = "2026-07-29T08:30:00.000Z"
const credentialHash = "a".repeat(64)
const capabilities = {
  providers: {
    claude_code: {
      enabled: true,
      available: true,
      authenticated: true,
      version: "5.0.0",
      models: ["claude-sonnet-5"],
      metadata: {},
    },
    codex: {
      enabled: true,
      available: false,
      authenticated: null,
      version: null,
      models: [],
      metadata: { reason: "not-installed" },
    },
  },
}

test("host state contracts expose setup and lifecycle values", () => {
  assert.deepEqual(
    ["enrolling", "ready", "setup_failed"].map((state) =>
      hostSetupStateSchema.parse(state)
    ),
    ["enrolling", "ready", "setup_failed"]
  )
  assert.deepEqual(
    ["setup-incomplete", "online", "offline", "banned"].map(
      (state) => hostLifecycleStateSchema.parse(state)
    ),
    ["setup-incomplete", "online", "offline", "banned"]
  )
})

test("hostNormalizedNameSchema trims, compacts, and lowercases names", () => {
  assert.equal(
    hostNormalizedNameSchema.parse("  Alpha   Host  "),
    "alpha host"
  )
  assert.throws(() => hostNormalizedNameSchema.parse("x".repeat(81)))
})

test("hostCapabilitiesSchema validates structured provider capabilities", () => {
  assert.deepEqual(hostCapabilitiesSchema.parse(capabilities), capabilities)
  assert.throws(() =>
    hostCapabilitiesSchema.parse({ providers: { openai: {} } })
  )
})

test("enrollment inputs keep persisted secrets hashed", () => {
  assert.deepEqual(
    createHostEnrollmentCodeInputSchema.parse({
      code_hash: credentialHash,
      expires_at: "2026-07-29T09:30:00.000Z",
    }),
    {
      code_hash: credentialHash,
      expires_at: "2026-07-29T09:30:00.000Z",
    }
  )

  assert.deepEqual(
    consumeHostEnrollmentCodeInputSchema.parse({
      code: "connect-host-code",
      display_name: "Alpha Host",
      telemetry: {
        gentic_version: "0.14.0",
        os: "linux",
        arch: "x64",
        configured_capacity: 2,
        provider_capabilities: capabilities,
        process_started_at: now,
      },
    }).display_name,
    "Alpha Host"
  )

  assert.throws(() =>
    createHostEnrollmentCodeInputSchema.parse({
      code: "raw-code",
      expires_at: "2026-07-29T09:30:00.000Z",
    })
  )
})

test("heartbeat telemetry validates host process state", () => {
  const telemetry = {
    process_started_at: now,
    gentic_version: "0.14.0",
    os: "linux",
    arch: "x64",
    configured_capacity: 3,
    setup_completed: true,
    provider_capabilities: capabilities,
    last_seen_at: now,
  }

  assert.deepEqual(hostHeartbeatTelemetrySchema.parse(telemetry), telemetry)
  assert.throws(() =>
    hostHeartbeatTelemetrySchema.parse({
      ...telemetry,
      configured_capacity: 0,
    })
  )
})

test("management and lifecycle inputs reject empty updates", () => {
  assert.deepEqual(
    renameHostInputSchema.parse({
      display_name: "Build box",
    }),
    {
      display_name: "Build box",
    }
  )
  assert.throws(() =>
    renameHostInputSchema.parse({ display_name: "x".repeat(81) })
  )
  assert.deepEqual(hostLifecycleOperationInputSchema.parse({}), {})
  assert.throws(() => hostLifecycleOperationInputSchema.parse({ force: true }))

  assert.deepEqual(
    updateHostManagementInputSchema.parse({
      id: hostId,
      display_name: "Build box",
    }),
    {
      id: hostId,
      display_name: "Build box",
    }
  )
  assert.throws(() => updateHostManagementInputSchema.parse({ id: hostId }))

  assert.deepEqual(
    hostLifecycleEventSchema.parse({
      host_id: hostId,
      state: "setup-incomplete",
      agent_provider: "codex",
      observed_at: now,
    }).state,
    "setup-incomplete"
  )
})
