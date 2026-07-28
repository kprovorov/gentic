import "server-only"

import { Output, gateway, generateText } from "ai"

import {
  issueClassificationSchema,
  type GeneratedIssueType,
} from "./type-parser"

const ISSUE_TYPE_MODEL = process.env.ISSUE_TYPE_MODEL ?? "openai/gpt-4.1-mini"

export async function generateIssueType(
  prompt: string
): Promise<GeneratedIssueType> {
  const { output } = await generateText({
    model: gateway(ISSUE_TYPE_MODEL),
    output: Output.object({
      schema: issueClassificationSchema,
      name: "issue_classification",
      description: "Classifies an issue tracker prompt as a feature or bug.",
    }),
    system:
      "Classify issue tracker prompts as either feature work or bug fixes.",
    prompt: `Classify this issue prompt:\n\n${prompt}`,
    maxOutputTokens: 40,
    temperature: 0,
  })

  return output.type
}
