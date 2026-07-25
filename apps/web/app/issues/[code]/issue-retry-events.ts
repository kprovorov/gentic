import type { IssueStatus } from "@gentic/validators/issues"

import type { ChatMessage } from "./issue-chat-state"

export const ISSUE_RETRY_RESET_EVENT = "gentic:issue-retry-reset"

export type IssueRetryResetEventDetail = {
  issueId: string
  message: ChatMessage
  status: IssueStatus
  usageLimitResetAt: string | null
  prUrl: string | null
  pullRequests: []
}
