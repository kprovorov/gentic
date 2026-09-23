import { z } from "zod"

import { sanitizeSkillInstallOutput } from "./skills.js"

/**
 * The CLIs a host runs work with and can be asked to update from Settings.
 * `gentic` is the host CLI itself; the other three are the external tools
 * `gentic doctor` checks for.
 */
export const hostToolSchema = z.enum([
  "gentic",
  "claude_code",
  "codex",
  "github",
])

export type HostTool = z.infer<typeof hostToolSchema>

export const HOST_TOOLS = hostToolSchema.options

export const hostToolUpdateStatusSchema = z.enum([
  "waiting",
  "updating",
  "updated",
  "failed",
  "timed-out",
])

export type HostToolUpdateStatus = z.infer<typeof hostToolUpdateStatusSchema>

export const hostToolUpdateTerminalStatusSchema =
  hostToolUpdateStatusSchema.extract(["updated", "failed"])

export const createHostToolUpdateInputSchema = z
  .object({
    tool: hostToolSchema,
  })
  .strict()

export type CreateHostToolUpdateInput = z.infer<
  typeof createHostToolUpdateInputSchema
>

export const reportHostToolUpdateResultInputSchema = z
  .object({
    status: hostToolUpdateTerminalStatusSchema,
    /** One line for the dialog: what happened, for successes and failures. */
    summary: z.string().max(500).nullable().optional(),
    /** Captured CLI output; only carried back for failures. */
    output: z.string().max(20_000).nullable().optional(),
    /** The tool's version as observed after the update finished. */
    version: z.string().trim().min(1).max(100).nullable().optional(),
  })
  .strict()

export type ReportHostToolUpdateResultInput = z.infer<
  typeof reportHostToolUpdateResultInputSchema
>

export const hostToolUpdateCommandSchema = z
  .object({
    id: z.string().uuid(),
    tool: hostToolSchema,
    expires_at: z.string(),
  })
  .strict()

export type HostToolUpdateCommand = z.infer<typeof hostToolUpdateCommandSchema>

export const claimHostToolUpdateResponseSchema = z
  .object({
    command: hostToolUpdateCommandSchema.nullable(),
  })
  .strict()

export type ClaimHostToolUpdateResponse = z.infer<
  typeof claimHostToolUpdateResponseSchema
>

export const hostToolUpdateSchema = z
  .object({
    id: z.string(),
    host_id: z.string(),
    tool: hostToolSchema,
    status: hostToolUpdateStatusSchema,
    summary: z.string().nullable(),
    output: z.string().nullable(),
    version: z.string().nullable(),
    created_at: z.string(),
    expires_at: z.string(),
  })
  .strict()

export type HostToolUpdate = z.infer<typeof hostToolUpdateSchema>

/**
 * Strips credentials and machine-identifying paths out of CLI output before
 * it is stored or shown; the same scrubber skill installs use, because the
 * output of `npm install -g` or `brew upgrade` leaks the same things.
 */
export const sanitizeHostToolUpdateOutput = sanitizeSkillInstallOutput
