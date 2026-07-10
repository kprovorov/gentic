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

export const agentProviderSchema = z.enum(["claude_code", "codex"])

export type AgentProvider = z.infer<typeof agentProviderSchema>

export const issueTypeSchema = z.enum(["feature", "bug", "feedback", "idea"])

export type IssueType = z.infer<typeof issueTypeSchema>

export const createIssueSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  prompt: z.string().trim().optional(),
  status: issueStatusSchema,
  agent_provider: agentProviderSchema.default("claude_code"),
  type: issueTypeSchema.default("feature"),
})

export type CreateIssueValues = z.infer<typeof createIssueSchema>

export const updateIssueSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  prompt: z.string().trim().optional(),
  agent_provider: agentProviderSchema,
  type: issueTypeSchema,
})

export type UpdateIssueValues = z.infer<typeof updateIssueSchema>

export const updateIssueStatusSchema = z.object({
  id: z.string().uuid(),
  status: issueStatusSchema,
})

export type UpdateIssueStatusValues = z.infer<typeof updateIssueStatusSchema>

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
