import "server-only"

import { gateway, generateText } from "ai"

import {
  ISSUE_CLASSIFICATION_TYPES,
  fallbackIssueType,
  parseGeneratedIssueType,
  type GeneratedIssueType,
} from "./type-parser"

const ISSUE_TYPE_MODEL = process.env.ISSUE_TYPE_MODEL ?? "openai/gpt-4.1-mini"

export async function generateIssueType(
  prompt: string
): Promise<GeneratedIssueType> {
  const { text } = await generateText({
    model: gateway(ISSUE_TYPE_MODEL),
    system: `Classify issue tracker prompts into exactly one type: ${ISSUE_CLASSIFICATION_TYPES.join(", ")}. Reply with that single word only, no punctuation and no explanation.`,
    prompt: `Classify this issue prompt:\n\n${prompt}`,
    maxOutputTokens: 20,
    temperature: 0,
  })

  // Models don't reliably stick to "return only the type" — strip anything
  // but letters and match the first known type mentioned anywhere in the
  // response, the same tolerant approach `generateIssueTitle` uses for
  // stray quotes/punctuation.
  return parseGeneratedIssueType(text) ?? fallbackIssueType(prompt)
}
