import { z } from "zod"

import { agentProviderSchema } from "./issues.js"

export const workerSetupStateSchema = z.enum([
  "enrolling",
  "ready",
  "setup_failed",
])

export type WorkerSetupState = z.infer<typeof workerSetupStateSchema>

export const workerLifecycleStateSchema = z.enum([
  "enrolling",
  "online",
  "offline",
  "banned",
  "setup_failed",
])

export type WorkerLifecycleState = z.infer<typeof workerLifecycleStateSchema>

export const workerDisplayNameSchema = z.string().trim().min(1).max(120)

export const workerNormalizedNameSchema = workerDisplayNameSchema.transform(
  (value) => value.replace(/\s+/g, " ").toLowerCase()
)

export const workerHashSchema = z.string().trim().min(32).max(512)

export const workerCapacitySchema = z.number().int().min(1).max(64)

export const workerPlatformSchema = z.string().trim().min(1).max(100)

export const workerProviderCapabilitySchema = z
  .object({
    enabled: z.boolean(),
    available: z.boolean(),
    authenticated: z.boolean().nullable(),
    version: z.string().trim().min(1).max(100).nullable(),
    models: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()

export type WorkerProviderCapability = z.infer<
  typeof workerProviderCapabilitySchema
>

export const workerCapabilitiesSchema = z
  .object({
    providers: z
      .object({
        claude_code: workerProviderCapabilitySchema.optional(),
        codex: workerProviderCapabilitySchema.optional(),
      })
      .strict(),
  })
  .strict()

export type WorkerCapabilities = z.infer<typeof workerCapabilitiesSchema>

export const workerEnrollmentCodeSchema = z.string().trim().min(16).max(256)

export const createWorkerEnrollmentCodeInputSchema = z
  .object({
    code_hash: workerHashSchema,
    expires_at: z.string().datetime({ offset: true }),
  })
  .strict()

export type CreateWorkerEnrollmentCodeInput = z.infer<
  typeof createWorkerEnrollmentCodeInputSchema
>

export const consumeWorkerEnrollmentCodeInputSchema = z
  .object({
    code: workerEnrollmentCodeSchema,
    credential_hash: workerHashSchema,
    display_name: workerDisplayNameSchema,
    telemetry: z
      .object({
        gentic_version: workerPlatformSchema.nullable(),
        os: workerPlatformSchema.nullable(),
        arch: workerPlatformSchema.nullable(),
        configured_capacity: workerCapacitySchema,
        provider_capabilities: workerCapabilitiesSchema,
        process_started_at: z.string().datetime({ offset: true }).nullable(),
      })
      .strict(),
  })
  .strict()

export type ConsumeWorkerEnrollmentCodeInput = z.infer<
  typeof consumeWorkerEnrollmentCodeInputSchema
>

export const workerHeartbeatTelemetrySchema = z
  .object({
    worker_id: z.string().uuid(),
    process_started_at: z.string().datetime({ offset: true }),
    gentic_version: workerPlatformSchema,
    os: workerPlatformSchema,
    arch: workerPlatformSchema,
    configured_capacity: workerCapacitySchema,
    provider_capabilities: workerCapabilitiesSchema,
    last_seen_at: z.string().datetime({ offset: true }).optional(),
  })
  .strict()

export type WorkerHeartbeatTelemetry = z.infer<
  typeof workerHeartbeatTelemetrySchema
>

export const updateWorkerManagementInputSchema = z
  .object({
    id: z.string().uuid(),
    display_name: workerDisplayNameSchema.optional(),
    setup_state: workerSetupStateSchema.optional(),
    banned_at: z.string().datetime({ offset: true }).nullable().optional(),
    configured_capacity: workerCapacitySchema.optional(),
    provider_capabilities: workerCapabilitiesSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1)

export type UpdateWorkerManagementInput = z.infer<
  typeof updateWorkerManagementInputSchema
>

export const workerLifecycleEventSchema = z
  .object({
    worker_id: z.string().uuid(),
    state: workerLifecycleStateSchema,
    agent_provider: agentProviderSchema.nullable().optional(),
    observed_at: z.string().datetime({ offset: true }),
  })
  .strict()

export type WorkerLifecycleEvent = z.infer<typeof workerLifecycleEventSchema>
