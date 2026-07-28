import { z } from "zod"

export const ISSUE_CLASSIFICATION_TYPES = ["feature", "bug"] as const

export type GeneratedIssueType = (typeof ISSUE_CLASSIFICATION_TYPES)[number]

export const issueClassificationSchema = z.object({
  type: z.enum(ISSUE_CLASSIFICATION_TYPES),
})

export function fallbackIssueType(prompt: string): GeneratedIssueType {
  const bugPattern =
    /\b(bug|fix|broken|crash|crashes|error|exception|fail|fails|failure|regression|incorrect|wrong|invalid|timeout|stuck|cannot|can't|doesn't|doesnt|not working)\b/i

  return bugPattern.test(prompt) ? "bug" : "feature"
}
