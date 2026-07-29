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
    ["setup-incomplete", "online", "offline", "banned"].map(
      (state) => workerLifecycleStateSchema.parse(state)
    ),
    ["setup-incomplete", "online", "offline", "banned"]
  )
})

test("workerNormalizedNameSchema trims, compacts, and lowercases names", () => {
  assert.equal(
    workerNormalizedNameSchema.parse("  Alpha   Worker  "),
    "alpha worker"
  )
  assert.throws(() => workerNormalizedNameSchema.parse("x".repeat(81)))
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
      display_name: "Alpha Worker",
      telemetry: {
        gentic_version: "0.14.0",
        os: "linux",
        arch: "x64",
        configured_capacity: 2,
        provider_capabilities: capabilities,
        process_started_at: now,
      },
    }).display_name,
    "Alpha Worker"
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
    process_started_at: now,
    gentic_version: "0.14.0",
    os: "linux",
    arch: "x64",
    configured_capacity: 3,
    setup_completed: true,
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
      state: "setup-incomplete",
      agent_provider: "codex",
      observed_at: now,
    }).state,
    "setup-incomplete"
  )
})
