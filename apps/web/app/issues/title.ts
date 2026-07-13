import "server-only"

import { openai } from "@ai-sdk/openai"
import { generateText } from "ai"

const ISSUE_TITLE_MODEL = process.env.ISSUE_TITLE_MODEL ?? "gpt-4.1-mini"

export async function generateIssueTitle(prompt: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required to generate issue titles")
  }

  const { text } = await generateText({
    model: openai(ISSUE_TITLE_MODEL),
    system:
      "Generate concise issue tracker titles. Return only the title text. Do not use quotes, markdown, punctuation at the end, or labels like Feature/Bug.",
    prompt: `Write a clear issue title for this prompt:\n\n${prompt}`,
    maxOutputTokens: 24,
    temperature: 0.2,
  })

  const title = text
    .trim()
    .replace(/^["'`]+|["'`.]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 160)
    .trim()

  if (!title) {
    throw new Error("AI did not return an issue title")
  }

  return title
}
