import { z } from "zod"

export const issueStatusSchema = z.enum([
  "draft",
  "todo",
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
  "completed",
])

export type IssueStatus = z.infer<typeof issueStatusSchema>

export const createIssueSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  prompt: z.string().trim().optional(),
  status: issueStatusSchema,
})

export type CreateIssueValues = z.infer<typeof createIssueSchema>

export const updateIssueSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  prompt: z.string().trim().optional(),
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
