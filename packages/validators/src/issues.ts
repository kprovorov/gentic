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
  agent_provider: agentProviderSchema.default("claude_code"),
  issue_model: issueModelSchema.default(null),
  // Omitted by the web app's create-issue form the same way: the type is
  // classified in the background after the issue is saved, so it defaults
  // to the "issue" placeholder until then.
  type: issueTypeSchema.default("issue"),
})

export type CreateIssueValues = z.infer<typeof createIssueSchema>

export const updateIssueSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  prompt: z.string().trim().optional(),
  agent_provider: agentProviderSchema,
  issue_model: issueModelSchema,
  type: issueTypeSchema,
})

export type UpdateIssueValues = z.infer<typeof updateIssueSchema>

export const updateIssueStatusSchema = z.object({
  id: z.string().uuid(),
  status: issueStatusSchema,
})

export type UpdateIssueStatusValues = z.infer<typeof updateIssueStatusSchema>

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
