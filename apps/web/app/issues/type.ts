import "server-only"

import { gateway, generateText } from "ai"

import type { IssueType } from "@gentic/validators/issues"

const ISSUE_TYPE_MODEL = process.env.ISSUE_TYPE_MODEL ?? "openai/gpt-4.1-mini"

// "feedback" is intentionally excluded: it was the most ambiguous of the
// four original categories and pushed the model toward hedging, explanatory
// responses (e.g. "This is general feedback about X, so: feedback") that
// blew past the output token budget before the actual word appeared.
const ISSUE_TYPES = ["feature", "bug", "idea"] as const

export async function generateIssueType(prompt: string): Promise<IssueType> {
  const { text } = await generateText({
    model: gateway(ISSUE_TYPE_MODEL),
    system: `Classify issue tracker prompts into exactly one type: ${ISSUE_TYPES.join(", ")}. Reply with that single word only — no punctuation, no explanation.`,
    prompt: `Classify this issue prompt:\n\n${prompt}`,
    maxOutputTokens: 20,
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
