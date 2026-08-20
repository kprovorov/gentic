import { z } from "zod"
import { agentProviderSchema, isIssueModelForAgent, issueModelSchema } from "./issues"

export const projectSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    repo: z
      .string()
      .trim()
      .regex(
        /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/,
        "Use the format user/repo"
      ),
    setup_script: z
      .string()
      .trim()
      .max(10000)
      .transform((value) => (value.length > 0 ? value : null))
      .nullable(),
    auto_respond_to_reviews: z.boolean(),
    automatic_review_enabled: z.boolean().default(false),
    // Null means "Same as Issue": the reviewer follows whatever provider/model
    // the Issue itself uses.
    automatic_review_provider: agentProviderSchema.nullable().default(null),
    automatic_review_model: issueModelSchema.default(null),
    automatic_review_instructions: z
      .string()
      .trim()
      .max(10000)
      .transform((value) => (value.length > 0 ? value : null))
      .nullable(),
  })
  .refine(
    (value) =>
      value.automatic_review_provider === null ||
      isIssueModelForAgent(
        value.automatic_review_provider,
        value.automatic_review_model
      ),
    {
      message: "Reviewer model is not available for the selected provider.",
      path: ["automatic_review_model"],
    }
  )

export type ProjectValues = z.infer<typeof projectSchema>

export const idSchema = z.string().uuid()
