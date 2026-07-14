import "server-only"

import { gateway, generateText } from "ai"

import type { IssueType } from "@gentic/validators/issues"

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

  // Models don't reliably stick to "return only the type" — strip anything
  // but letters and match the first known type mentioned anywhere in the
  // response, the same tolerant approach `generateIssueTitle` uses for
  // stray quotes/punctuation.
  const normalized = text.trim().toLowerCase().replace(/[^a-z]/g, "")
  const type = ISSUE_TYPES.find((candidate) => normalized.includes(candidate))

  if (!type) {
    throw new Error(`AI Gateway returned an invalid issue type: "${text}"`)
  }

  return type
}
