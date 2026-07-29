import assert from "node:assert/strict"
import { test } from "node:test"

import {
  consumeWorkerEnrollmentCodeInputSchema,
  createWorkerEnrollmentCodeInputSchema,
  updateWorkerManagementInputSchema,
  workerCapabilitiesSchema,
  workerHeartbeatTelemetrySchema,
  workerLifecycleEventSchema,
  workerLifecycleStateSchema,
  workerNormalizedNameSchema,
  workerSetupStateSchema,
} from "./workers.js"

const workerId = "8f14e45f-ceea-467e-b7ea-05a3e2b3f4c1"
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

test("worker state contracts expose setup and lifecycle values", () => {
  assert.deepEqual(
    ["enrolling", "ready", "setup_failed"].map((state) =>
      workerSetupStateSchema.parse(state)
    ),
    ["enrolling", "ready", "setup_failed"]
  )
  assert.deepEqual(
    ["enrolling", "online", "offline", "banned", "setup_failed"].map(
      (state) => workerLifecycleStateSchema.parse(state)
    ),
    ["enrolling", "online", "offline", "banned", "setup_failed"]
  )
})

test("workerNormalizedNameSchema trims, compacts, and lowercases names", () => {
  assert.equal(
    workerNormalizedNameSchema.parse("  Alpha   Worker  "),
    "alpha worker"
  )
})

test("workerCapabilitiesSchema validates structured provider capabilities", () => {
  assert.deepEqual(workerCapabilitiesSchema.parse(capabilities), capabilities)
  assert.throws(() =>
    workerCapabilitiesSchema.parse({ providers: { openai: {} } })
  )
})

test("enrollment inputs keep persisted secrets hashed", () => {
  assert.deepEqual(
    createWorkerEnrollmentCodeInputSchema.parse({
      code_hash: credentialHash,
      expires_at: "2026-07-29T09:30:00.000Z",
    }),
    {
      code_hash: credentialHash,
      expires_at: "2026-07-29T09:30:00.000Z",
    }
  )

  assert.deepEqual(
    consumeWorkerEnrollmentCodeInputSchema.parse({
      code: "connect-worker-code",
      credential_hash: credentialHash,
      display_name: "Alpha Worker",
      telemetry: {
        gentic_version: "0.14.0",
        os: "linux",
        arch: "x64",
        configured_capacity: 2,
        provider_capabilities: capabilities,
        process_started_at: now,
      },
    }).credential_hash,
    credentialHash
  )

  assert.throws(() =>
    createWorkerEnrollmentCodeInputSchema.parse({
      code: "raw-code",
      expires_at: "2026-07-29T09:30:00.000Z",
    })
  )
})

test("heartbeat telemetry validates worker process state", () => {
  const telemetry = {
    worker_id: workerId,
    process_started_at: now,
    gentic_version: "0.14.0",
    os: "linux",
    arch: "x64",
    configured_capacity: 3,
    provider_capabilities: capabilities,
    last_seen_at: now,
  }

  assert.deepEqual(workerHeartbeatTelemetrySchema.parse(telemetry), telemetry)
  assert.throws(() =>
    workerHeartbeatTelemetrySchema.parse({
      ...telemetry,
      configured_capacity: 0,
    })
  )
})

test("management and lifecycle inputs reject empty updates", () => {
  assert.deepEqual(
    updateWorkerManagementInputSchema.parse({
      id: workerId,
      display_name: "Build box",
    }),
    {
      id: workerId,
      display_name: "Build box",
    }
  )
  assert.throws(() => updateWorkerManagementInputSchema.parse({ id: workerId }))

  assert.deepEqual(
    workerLifecycleEventSchema.parse({
      worker_id: workerId,
      state: "online",
      agent_provider: "codex",
      observed_at: now,
    }).state,
    "online"
  )
})
