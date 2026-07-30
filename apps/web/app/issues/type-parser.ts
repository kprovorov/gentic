import { z } from "zod"

import { issuePrioritySchema } from "@gentic/validators/issues"

import { MAX_TITLE_LENGTH } from "./title-format"

export const ISSUE_CLASSIFICATION_TYPES = ["feature", "bug"] as const

export type GeneratedIssueType = (typeof ISSUE_CLASSIFICATION_TYPES)[number]

export const issueMetadataSchema = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
  type: z.enum(ISSUE_CLASSIFICATION_TYPES),
  priority: issuePrioritySchema,
})

export type GeneratedIssueMetadata = z.infer<typeof issueMetadataSchema>

export function fallbackIssueType(prompt: string): GeneratedIssueType {
  const bugPattern =
    /\b(bug|fix|broken|crash|crashes|error|exception|fail|fails|failure|regression|incorrect|wrong|invalid|timeout|stuck|cannot|can't|doesn't|doesnt|not working)\b/i

  return bugPattern.test(prompt) ? "bug" : "feature"
}
