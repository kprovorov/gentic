import "server-only"

import { gateway, generateText } from "ai"

import {
  formatGeneratedIssueTitle,
  MAX_TITLE_LENGTH,
} from "./title-format"

const ISSUE_TITLE_MODEL =
  process.env.ISSUE_TITLE_MODEL ?? "openai/gpt-4.1-mini"

export async function generateIssueTitle(prompt: string): Promise<string> {
  const { text } = await generateText({
    model: gateway(ISSUE_TITLE_MODEL),
    system:
      `Generate short issue tracker titles, ${MAX_TITLE_LENGTH} characters or fewer. Return only the title text. Do not use quotes, markdown, punctuation at the end, or labels like Feature/Bug.`,
    prompt: `Write a short issue title for this prompt:\n\n${prompt}`,
    maxOutputTokens: 32,
    temperature: 0.2,
  })

  const title = formatGeneratedIssueTitle(text)

  if (!title) {
    throw new Error("AI Gateway did not return an issue title")
  }

  return title
}
