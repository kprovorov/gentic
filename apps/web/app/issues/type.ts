import "server-only"

import { gateway, generateText } from "ai"

import { issueTypeSchema, type IssueType } from "@gentic/validators/issues"

const ISSUE_TYPE_MODEL = process.env.ISSUE_TYPE_MODEL ?? "openai/gpt-4.1-mini"

const ISSUE_TYPES = ["feature", "bug", "feedback", "idea"] as const

export async function generateIssueType(prompt: string): Promise<IssueType> {
  const { text } = await generateText({
    model: gateway(ISSUE_TYPE_MODEL),
    system: `Classify issue tracker prompts into exactly one type: ${ISSUE_TYPES.join(", ")}. Return only the type, lowercase, no punctuation, no other text.`,
    prompt: `Classify this issue prompt:\n\n${prompt}`,
    maxOutputTokens: 8,
    temperature: 0,
  })

  const type = issueTypeSchema.safeParse(text.trim().toLowerCase())

  if (!type.success || type.data === "issue") {
    throw new Error(`AI Gateway returned an invalid issue type: "${text}"`)
  }

  return type.data
}
