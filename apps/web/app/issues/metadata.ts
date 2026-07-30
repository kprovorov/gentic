import "server-only"

import { Output, gateway, generateText } from "ai"

import { formatGeneratedIssueTitle, MAX_TITLE_LENGTH } from "./title-format"
import {
  issueMetadataSchema,
  type GeneratedIssueMetadata,
} from "./type-parser"

const ISSUE_METADATA_MODEL =
  process.env.ISSUE_METADATA_MODEL ?? "openai/gpt-4.1-mini"

export async function generateIssueMetadata(
  prompt: string
): Promise<GeneratedIssueMetadata> {
  const { output } = await generateText({
    model: gateway(ISSUE_METADATA_MODEL),
    output: Output.object({
      schema: issueMetadataSchema,
      name: "issue_metadata",
      description:
        "Generates a short issue tracker title, classifies the issue as feature work or a bug fix, and rates its priority.",
    }),
    system:
      `Generate a short issue tracker title (${MAX_TITLE_LENGTH} characters or fewer; no quotes, markdown, trailing punctuation, or labels like Feature/Bug), classify the issue as feature work or a bug fix, and rate its priority.`,
    prompt: `Generate metadata for this issue prompt:\n\n${prompt}`,
    maxOutputTokens: 80,
    temperature: 0.2,
  })

  const title = formatGeneratedIssueTitle(output.title)

  if (!title) {
    throw new Error("AI Gateway did not return an issue title")
  }

  return { title, type: output.type, priority: output.priority }
}
