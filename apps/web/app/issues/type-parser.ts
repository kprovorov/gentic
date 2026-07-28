export const ISSUE_CLASSIFICATION_TYPES = ["feature", "bug"] as const

export type GeneratedIssueType = (typeof ISSUE_CLASSIFICATION_TYPES)[number]

export function parseGeneratedIssueType(
  text: string
): GeneratedIssueType | null {
  const words: string[] = text.toLowerCase().match(/[a-z]+/g) ?? []
  return (
    ISSUE_CLASSIFICATION_TYPES.find((candidate) => words.includes(candidate)) ??
    null
  )
}

export function fallbackIssueType(prompt: string): GeneratedIssueType {
  const bugPattern =
    /\b(bug|fix|broken|crash|crashes|error|exception|fail|fails|failure|regression|incorrect|wrong|invalid|timeout|stuck|cannot|can't|doesn't|doesnt|not working)\b/i

  return bugPattern.test(prompt) ? "bug" : "feature"
}
