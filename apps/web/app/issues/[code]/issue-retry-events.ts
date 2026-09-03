import type { IssueStatus } from "@gentic/validators/issues"

import type { ChatMessage } from "./issue-chat-state"

export const ISSUE_RETRY_RESET_EVENT = "gentic:issue-retry-reset"

export type IssueRetryResetEventDetail = {
  issueId: string
  message: ChatMessage
  status: IssueStatus
  usageLimitResetAt: string | null
  pullRequests: []
  // Runs whose transcript this reset deleted. Their host is still alive and
  // still broadcasting, so the chat has to keep refusing their events for the
  // rest of this page's life. See `discarded-runs.ts`.
  discardedRunIds: string[]
}
