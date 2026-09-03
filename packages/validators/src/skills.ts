import { z } from "zod"

/**
 * Only the canonical single-skill page URL identifies exactly one skill:
 * `https://skills.sh/{owner}/{repo}/{skill}`. Everything else skills.sh
 * serves — repository pages, packs, topics, the leaderboard — either names no
 * skill or names several, so it is rejected rather than guessed at.
 */
export const SKILLS_SH_HOSTS = ["skills.sh", "www.skills.sh"] as const

// First path segments skills.sh reserves for its own pages. `p` (packs) and
// `t` (topics) are the multi-skill routes; the rest are navigation.
const RESERVED_SKILLS_SH_SEGMENTS = new Set([
  "api",
  "docs",
  "hot",
  "leaderboard",
  "login",
  "new",
  "p",
  "search",
  "settings",
  "t",
  "trending",
  "u",
])

const pathSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

const pathSegmentSchema = z
  .string()
  .regex(pathSegmentPattern)
  .refine((value) => value !== "." && value !== "..")

/** A GitHub `owner/repo` pair, the CLI's `add <source>` argument. */
export const skillSourceSchema = z
  .string()
  .trim()
  .max(201)
  .refine((value) => {
    const parts = value.split("/")
    return parts.length === 2 && parts.every(isSkillPathSegment)
  })

/** A single skill slug, the CLI's `--skill <skill>` argument. */
export const skillSlugSchema = z.string().trim().max(100).refine(isSkillPathSegment)

export type SkillReference = {
  /** `owner/repo` — passed to the CLI as the install source. */
  source: string
  /** The skill slug within that repository. */
  skill: string
  /** The normalized canonical page URL, for display only. */
  url: string
}

export class SkillUrlError extends Error {}

/**
 * Parses a canonical skills.sh skill URL into the structured arguments the
 * CLI is invoked with. The submitted URL itself never reaches the CLI or a
 * shell — only `source` and `skill`, both constrained to a safe charset.
 */
export function parseSkillsShSkillUrl(value: string): SkillReference {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new SkillUrlError("Enter a skills.sh skill URL.")
  }

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new SkillUrlError(
      "Enter a full skill URL, for example https://skills.sh/owner/repo/skill."
    )
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SkillUrlError("Only https://skills.sh URLs can be installed.")
  }
  if (!(SKILLS_SH_HOSTS as readonly string[]).includes(url.hostname)) {
    throw new SkillUrlError("Only skills.sh URLs can be installed.")
  }

  const segments = url.pathname.split("/").filter(Boolean).map(decodeSegment)

  if (segments.length !== 3) {
    throw new SkillUrlError(
      segments.length < 3
        ? "That URL does not point at a single skill. Use the skill page URL, for example https://skills.sh/owner/repo/skill."
        : "That URL does not point at a single skill."
    )
  }
  if (RESERVED_SKILLS_SH_SEGMENTS.has(segments[0].toLowerCase())) {
    throw new SkillUrlError(
      "That URL does not point at a single skill. Packs, topics and listings install more than one skill."
    )
  }
  if (!segments.every(isSkillPathSegment)) {
    throw new SkillUrlError("That URL does not point at a single skill.")
  }

  const [owner, repo, skill] = segments
  return {
    source: `${owner}/${repo}`,
    skill,
    url: `https://skills.sh/${owner}/${repo}/${skill}`,
  }
}

export const skillsShSkillUrlSchema = z.string().transform((value, ctx) => {
  try {
    return parseSkillsShSkillUrl(value)
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message:
        error instanceof SkillUrlError ? error.message : "Invalid skill URL",
    })
    return z.NEVER
  }
})

export const skillAuditStatusSchema = z.enum(["pass", "warn", "fail"])

export type SkillAuditStatus = z.infer<typeof skillAuditStatusSchema>

export const skillAuditSchema = z.object({
  provider: z.string().max(200),
  slug: z.string().max(200).optional(),
  status: skillAuditStatusSchema,
  summary: z.string().max(4000).optional(),
  auditedAt: z.string().max(100).optional(),
  riskLevel: z.string().max(100).optional(),
  categories: z.array(z.string().max(100)).max(50).optional(),
})

export type SkillAudit = z.infer<typeof skillAuditSchema>

export const skillAuditsResponseSchema = z.object({
  id: z.string().max(400),
  source: z.string().max(400),
  slug: z.string().max(200),
  audits: z.array(skillAuditSchema).max(50),
})

export const skillAuditGateDecisionSchema = z.enum([
  "allow",
  "confirm",
  "block",
])

export type SkillAuditGateDecision = z.infer<typeof skillAuditGateDecisionSchema>

export const skillAuditGateReasonSchema = z.enum([
  "failed",
  "warning",
  "stale",
  "missing",
  "unavailable",
])

export type SkillAuditGateReason = z.infer<typeof skillAuditGateReasonSchema>

export const skillAuditGateSchema = z
  .object({
    decision: skillAuditGateDecisionSchema,
    reasons: z.array(skillAuditGateReasonSchema),
    audits: z.array(skillAuditSchema),
  })
  .strict()

export type SkillAuditGate = z.infer<typeof skillAuditGateSchema>

export const skillAuditResultSchema = z
  .object({
    skill: z
      .object({
        source: skillSourceSchema,
        skill: skillSlugSchema,
        url: z.string(),
      })
      .strict(),
    gate: skillAuditGateSchema,
  })
  .strict()

export type SkillAuditResult = z.infer<typeof skillAuditResultSchema>

export const hostSkillInstallStatusSchema = z.enum([
  "waiting",
  "installing",
  "installed",
  "failed",
  "timed-out",
])

export type HostSkillInstallStatus = z.infer<
  typeof hostSkillInstallStatusSchema
>

export const hostSkillInstallTerminalStatusSchema =
  hostSkillInstallStatusSchema.extract(["installed", "failed"])

export const createHostSkillInstallsInputSchema = z
  .object({
    url: z.string().min(1).max(2048),
    host_ids: z.array(z.string().uuid()).min(1).max(64),
    accept_risk: z.boolean().default(false),
  })
  .strict()

export type CreateHostSkillInstallsInput = z.infer<
  typeof createHostSkillInstallsInputSchema
>

export const reportHostSkillInstallResultInputSchema = z
  .object({
    status: hostSkillInstallTerminalStatusSchema,
    error_summary: z.string().max(500).nullable().optional(),
    output: z.string().max(20_000).nullable().optional(),
  })
  .strict()

export type ReportHostSkillInstallResultInput = z.infer<
  typeof reportHostSkillInstallResultInputSchema
>

export const hostSkillInstallCommandSchema = z
  .object({
    id: z.string().uuid(),
    source: skillSourceSchema,
    skill: skillSlugSchema,
    expires_at: z.string(),
  })
  .strict()

export type HostSkillInstallCommand = z.infer<
  typeof hostSkillInstallCommandSchema
>

export const claimHostSkillInstallResponseSchema = z
  .object({
    command: hostSkillInstallCommandSchema.nullable(),
  })
  .strict()

export type ClaimHostSkillInstallResponse = z.infer<
  typeof claimHostSkillInstallResponseSchema
>

export const hostSkillInstallSchema = z
  .object({
    id: z.string(),
    host_id: z.string(),
    source: z.string(),
    skill: z.string(),
    url: z.string(),
    status: hostSkillInstallStatusSchema,
    error_summary: z.string().nullable(),
    output: z.string().nullable(),
    expires_at: z.string(),
  })
  .strict()

export type HostSkillInstall = z.infer<typeof hostSkillInstallSchema>

const OUTPUT_MAX_LENGTH = 8_000
const REDACTED = "[redacted]"

const redactionPatterns: Array<[RegExp, string]> = [
  // Gentic host credentials and enrollment codes.
  [/\bgt(?:wc|ce)_[A-Za-z0-9_-]+/g, REDACTED],
  // Well-known provider token shapes.
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, REDACTED],
  [/\bnpm_[A-Za-z0-9]{16,}/g, REDACTED],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\b(bearer|token|authorization)[=:]\s*\S+/gi, `$1: ${REDACTED}`],
  // `https://user:password@host` in a remote or registry URL.
  [/(:\/\/)[^/\s:@]+:[^/\s@]+@/g, `$1${REDACTED}@`],
  // Any environment-variable-looking assignment whose name reads as a secret.
  [
    /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD|PASSWD|CREDENTIAL)[A-Z0-9_]*)\s*=\s*\S+/g,
    `$1=${REDACTED}`,
  ],
  // Home directories leak the machine's account name.
  [/(?:\/home\/|\/Users\/|\\Users\\)[^/\\\s:"']+/g, "~"],
]

/**
 * Strips credentials and machine-identifying paths out of CLI output before it
 * is stored or shown. Applied on the host before reporting and again on the
 * server before persisting, so neither side has to be trusted alone.
 */
export function sanitizeSkillInstallOutput(value: string): string {
  // Strips ANSI colour codes.
  let output = value.replace(/\u001B\[[0-9;]*[A-Za-z]/g, "")

  for (const [pattern, replacement] of redactionPatterns) {
    output = output.replace(pattern, replacement)
  }

  output = output.trim()

  if (output.length > OUTPUT_MAX_LENGTH) {
    // Keep the tail: the CLI reports why it failed on its last lines.
    output = `...\n${output.slice(output.length - OUTPUT_MAX_LENGTH)}`
  }

  return output
}

function isSkillPathSegment(value: string): boolean {
  return pathSegmentSchema.safeParse(value).success
}

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
