import { z } from "zod"

import { agentProviderSchema } from "./issues.js"

export const hostSetupStateSchema = z.enum([
  "enrolling",
  "ready",
  "setup_failed",
])

export type HostSetupState = z.infer<typeof hostSetupStateSchema>

export const hostLifecycleStateSchema = z.enum([
  "setup-incomplete",
  "online",
  "offline",
  "banned",
])

export type HostLifecycleState = z.infer<typeof hostLifecycleStateSchema>

export const hostDisplayNameSchema = z.string().trim().min(1).max(80)

export const hostNormalizedNameSchema = hostDisplayNameSchema.transform(
  (value) => value.replace(/\s+/g, " ").toLowerCase()
)

export const hostHashSchema = z.string().trim().min(32).max(512)

export const hostCapacitySchema = z.number().int().min(1).max(64)

export const hostPlatformSchema = z.string().trim().min(1).max(100)

export const hostProviderCapabilitySchema = z
  .object({
    enabled: z.boolean(),
    available: z.boolean(),
    authenticated: z.boolean().nullable(),
    version: z.string().trim().min(1).max(100).nullable(),
    models: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()

export type HostProviderCapability = z.infer<
  typeof hostProviderCapabilitySchema
>

export const hostCapabilitiesSchema = z
  .object({
    providers: z
      .object({
        claude_code: hostProviderCapabilitySchema.optional(),
        codex: hostProviderCapabilitySchema.optional(),
      })
      .strict(),
  })
  .strict()

export type HostCapabilities = z.infer<typeof hostCapabilitiesSchema>

export const hostEnrollmentCodeSchema = z.string().trim().min(16).max(256)
// The `gtwc_` prefix predates the host rename and stays: it is the literal
// shape of every credential already issued. See `CREDENTIAL_PREFIX` in
// `@gentic/services/hosts`.
export const hostCredentialSchema = z
  .string()
  .trim()
  .regex(/^gtwc_[A-Za-z0-9_-]{32,}$/)
  .max(256)

export const createHostEnrollmentCodeInputSchema = z
  .object({
    code_hash: hostHashSchema,
    expires_at: z.string().datetime({ offset: true }),
  })
  .strict()

export type CreateHostEnrollmentCodeInput = z.infer<
  typeof createHostEnrollmentCodeInputSchema
>

export const consumeHostEnrollmentCodeInputSchema = z
  .object({
    code: hostEnrollmentCodeSchema,
    display_name: hostDisplayNameSchema,
    telemetry: z
      .object({
        gentic_version: hostPlatformSchema.nullable(),
        os: hostPlatformSchema.nullable(),
        arch: hostPlatformSchema.nullable(),
        configured_capacity: hostCapacitySchema,
        provider_capabilities: hostCapabilitiesSchema,
        process_started_at: z.string().datetime({ offset: true }).nullable(),
      })
      .strict(),
  })
  .strict()

export type ConsumeHostEnrollmentCodeInput = z.infer<
  typeof consumeHostEnrollmentCodeInputSchema
>

export const hostHeartbeatTelemetrySchema = z
  .object({
    process_started_at: z.string().datetime({ offset: true }),
    gentic_version: hostPlatformSchema,
    os: hostPlatformSchema,
    arch: hostPlatformSchema,
    configured_capacity: hostCapacitySchema,
    setup_completed: z.boolean(),
    provider_capabilities: hostCapabilitiesSchema,
    last_seen_at: z.string().datetime({ offset: true }).optional(),
  })
  .strict()

export type HostHeartbeatTelemetry = z.infer<
  typeof hostHeartbeatTelemetrySchema
>

export const hostOfflineInputSchema = z.object({}).strict()

export const hostControlResponseSchema = z
  .object({
    host: z.object({
      banned: z.boolean(),
    }),
    runs: z.array(
      z
        .object({
          issue_id: z.string().uuid(),
          active_run_id: z.string().uuid().nullable(),
          status: z.string(),
        })
        .strict()
    ),
    review_runs: z.array(
      z
        .object({
          review_run_id: z.string().uuid(),
          status: z.string(),
        })
        .strict()
    ),
  })
  .strict()

export type HostControlResponse = z.infer<typeof hostControlResponseSchema>

export const renameHostInputSchema = z
  .object({
    display_name: hostDisplayNameSchema,
  })
  .strict()

export type RenameHostInput = z.infer<typeof renameHostInputSchema>

export const hostLifecycleOperationInputSchema = z.object({}).strict()

export type HostLifecycleOperationInput = z.infer<
  typeof hostLifecycleOperationInputSchema
>

export const updateHostManagementInputSchema = z
  .object({
    id: z.string().uuid(),
    display_name: hostDisplayNameSchema.optional(),
    setup_state: hostSetupStateSchema.optional(),
    banned_at: z.string().datetime({ offset: true }).nullable().optional(),
    configured_capacity: hostCapacitySchema.optional(),
    provider_capabilities: hostCapabilitiesSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1)

export type UpdateHostManagementInput = z.infer<
  typeof updateHostManagementInputSchema
>

export const hostLifecycleEventSchema = z
  .object({
    host_id: z.string().uuid(),
    state: hostLifecycleStateSchema,
    agent_provider: agentProviderSchema.nullable().optional(),
    observed_at: z.string().datetime({ offset: true }),
  })
  .strict()

export type HostLifecycleEvent = z.infer<typeof hostLifecycleEventSchema>
