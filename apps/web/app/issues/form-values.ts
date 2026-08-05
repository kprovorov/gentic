import { z } from "zod"

import { createIssueSchema, updateIssueSchema } from "@gentic/validators/issues"

import { getString } from "../_lib/form-data"

const explicitBooleanSchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true")

export const createIssueFormSchema = createIssueSchema
  .omit({ title: true, status: true, type: true })
  .extend({
    body: z.string().trim().min(1).max(10_000),
    create_pr_automatically: explicitBooleanSchema,
  })

export const updateIssueFormSchema = updateIssueSchema.extend({
  create_pr_automatically: explicitBooleanSchema.optional(),
})

export function parseCreateIssueFormData(formData: FormData) {
  return createIssueFormSchema.parse({
    project_id: getString(formData, "project_id"),
    body: getString(formData, "body"),
    create_pr_automatically: getString(formData, "create_pr_automatically"),
    agent_provider: getString(formData, "agent_provider") || "claude_code",
    issue_model: getString(formData, "issue_model") || null,
    priority: getString(formData, "priority") || undefined,
    label_ids: formData.getAll("label_id").map(String),
  })
}

export function parseUpdateIssueFormData(formData: FormData) {
  return updateIssueFormSchema.parse({
    id: getString(formData, "id"),
    title: getString(formData, "title"),
    body: getString(formData, "body") || undefined,
    agent_provider: getString(formData, "agent_provider") || "claude_code",
    issue_model: getString(formData, "issue_model") || null,
    type: getString(formData, "type") || "feature",
    priority: getString(formData, "priority") || undefined,
    create_pr_automatically:
      getString(formData, "create_pr_automatically") || undefined,
  })
}
