import {
  deletedRowSchema,
  issuePullRequestSchema,
  issueRunStateRowSchema,
  messageEventSchema,
  runStateEventSchema,
} from "@gentic/validators/realtime"

export function parseMessageEventPayload(payload: unknown) {
  return messageEventSchema.safeParse(payload)
}

export function parseRunStatePayload(payload: unknown) {
  return runStateEventSchema.safeParse(payload)
}

export function parseIssueRunStateRow(row: unknown) {
  return issueRunStateRowSchema.safeParse(row)
}

export function parseIssuePullRequestRow(row: unknown) {
  return issuePullRequestSchema.safeParse(row)
}

export function parseDeletedRow(row: unknown) {
  return deletedRowSchema.safeParse(row)
}
