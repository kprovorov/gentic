import type { IssuePriority as SupabaseIssuePriority } from "@gentic/supabase/types"
import { z } from "zod"

export const issueStatusSchema = z.enum([
  "draft",
  "todo",
  "queued",
  "held",
  "in-progress",
  "waiting-for-input",
  "testing",
  "tests-failed",
  "ready-for-review",
  "changes-requested",
  "approved",
  "merged",
  "deploying",
  "deploy-failed",
  "validating",
  "run-failed",
  "completed",
  "cancelled",
])

export type IssueStatus = z.infer<typeof issueStatusSchema>

export type IssuePriority = SupabaseIssuePriority

const issuePriorityValues = [
  "low",
  "medium",
  "high",
  "urgent",
] as const satisfies readonly [IssuePriority, ...IssuePriority[]]

export const issuePrioritySchema = z.enum(issuePriorityValues)

export const defaultIssuePriority = "medium" as const satisfies IssuePriority

export const issuePriorityLabels = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
} as const satisfies Record<IssuePriority, string>

export const issuePriorityOrder = {
  low: 0,
  medium: 1,
  high: 2,
  urgent: 3,
} as const satisfies Record<IssuePriority, number>

export const issuePriorityIcons = {
  low: "down",
  medium: "minus",
  high: "up",
  urgent: "alert",
} as const satisfies Record<IssuePriority, "alert" | "down" | "minus" | "up">

export const issuePriorityStyles = {
  low: "border-border bg-muted text-foreground",
  medium: "border-border bg-muted text-foreground",
  high: "border-border bg-muted text-foreground",
  urgent: "border-border bg-muted text-foreground",
} as const satisfies Record<IssuePriority, string>

export const issuePriorityOptions = issuePriorityValues.map((value) => ({
  value,
  label: issuePriorityLabels[value],
  order: issuePriorityOrder[value],
  icon: issuePriorityIcons[value],
  className: issuePriorityStyles[value],
}))

export const agentProviderSchema = z.enum(["claude_code", "codex"])

export type AgentProvider = z.infer<typeof agentProviderSchema>

export const issueModelSchema = z.string().trim().min(1).max(100).nullable()

export type IssueModel = z.infer<typeof issueModelSchema>

export const agentModelOptions = {
  claude_code: [
    { value: "claude-opus-5", label: "Claude Opus 5" },
    { value: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { value: "claude-fable-5", label: "Claude Fable 5" },
  ],
  codex: [
    { value: "gpt-5.6", label: "GPT-5.6" },
    { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  ],
} as const satisfies Record<
  AgentProvider,
  Array<{ value: string; label: string }>
>

export function isIssueModelForAgent(
  agentProvider: AgentProvider,
  issueModel: string | null
): boolean {
  return (
    issueModel === null ||
    agentModelOptions[agentProvider].some(
      (option) => option.value === issueModel
    )
  )
}

// "issue" is a placeholder used before the background classifier (see
// apps/web/app/issues/type.ts) determines the real type — it is not a type
// callers should pick deliberately.
export const issueTypeSchema = z.enum([
  "issue",
  "feature",
  "bug",
  "feedback",
  "idea",
])

export type IssueType = z.infer<typeof issueTypeSchema>

export const createIssueSchema = z.object({
  project_id: z.string().uuid(),
  // Omitted by the web app's create-issue form: the title is generated in
  // the background after the issue is saved. Trusted callers that already
  // know the title (e.g. the MCP `create_issue` tool) may still supply one.
  title: z.string().trim().min(1).max(160).optional(),
  prompt: z.string().trim().optional(),
  status: issueStatusSchema,
  priority: issuePrioritySchema.default(defaultIssuePriority),
  create_pr_automatically: z.boolean().default(false),
  agent_provider: agentProviderSchema.default("claude_code"),
  issue_model: issueModelSchema.default(null),
  // Omitted by the web app's create-issue form the same way: the type is
  // classified in the background after the issue is saved, so it defaults
  // to the "issue" placeholder until then.
  type: issueTypeSchema.default("issue"),
  label_ids: z
    .array(z.string().uuid())
    .default([])
    .transform((ids) => Array.from(new Set(ids)))
    .refine((ids) => ids.length <= 20, {
      message: "An issue accepts at most 20 labels.",
    }),
})

export type CreateIssueValues = z.infer<typeof createIssueSchema>

export function hasAttachedIssuePullRequest(issue: {
  pr_url: string | null
  issue_pull_requests?: readonly unknown[] | null
}) {
  return Boolean(issue.pr_url) || (issue.issue_pull_requests?.length ?? 0) > 0
}

export const updateIssueSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  prompt: z.string().trim().optional(),
  agent_provider: agentProviderSchema,
  issue_model: issueModelSchema,
  type: issueTypeSchema,
  priority: issuePrioritySchema.default(defaultIssuePriority),
  create_pr_automatically: z.boolean().optional(),
})

export type UpdateIssueValues = z.infer<typeof updateIssueSchema>

export const updateIssueStatusSchema = z.object({
  id: z.string().uuid(),
  status: issueStatusSchema,
})

export type UpdateIssueStatusValues = z.infer<typeof updateIssueStatusSchema>

export const updateIssuePrioritySchema = z.object({
  id: z.string().uuid(),
  priority: issuePrioritySchema,
})

export type UpdateIssuePriorityValues = z.infer<
  typeof updateIssuePrioritySchema
>

export const updateIssueAgentProviderSchema = z.object({
  id: z.string().uuid(),
  agent_provider: agentProviderSchema,
  issue_model: issueModelSchema.default(null),
})

export type UpdateIssueAgentProviderValues = z.infer<
  typeof updateIssueAgentProviderSchema
>

export const sendIssueMessageSchema = z.object({
  issue_id: z.string().uuid(),
  content: z.string().trim().min(1).max(10_000),
})

export type SendIssueMessageValues = z.infer<typeof sendIssueMessageSchema>

export const issueRelationDirectionSchema = z.enum(["blocking", "blocked_by"])

export type IssueRelationDirection = z.infer<
  typeof issueRelationDirectionSchema
>

export const addIssueRelationSchema = z.object({
  issue_id: z.string().uuid(),
  related_issue_id: z.string().uuid(),
  direction: issueRelationDirectionSchema,
})

export type AddIssueRelationValues = z.infer<typeof addIssueRelationSchema>

export const deleteIssueRelationSchema = z.object({
  id: z.string().uuid(),
  issue_id: z.string().uuid(),
})

export type DeleteIssueRelationValues = z.infer<
  typeof deleteIssueRelationSchema
>

export const mutateIssueLabelsSchema = z.object({
  issue_ids: z
    .array(z.string().uuid())
    .min(1)
    .max(100)
    .transform((ids) => Array.from(new Set(ids))),
  label_ids: z
    .array(z.string().uuid())
    .min(1)
    .max(20)
    .transform((ids) => Array.from(new Set(ids))),
})

export type MutateIssueLabelsValues = z.infer<typeof mutateIssueLabelsSchema>
