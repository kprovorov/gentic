import type { Tables } from "@gentic/supabase/types"
import type { IssueStatus } from "@gentic/validators/issues"
import type { ChatMessageContract } from "@gentic/validators/realtime"

export const ISSUE_WITH_PROJECT_SELECT =
  "*, projects!inner(id,name,repo,user_id,key)"

export const RESOLVED_ISSUE_BLOCKER_STATUSES = [
  "merged",
  "deploying",
  "deploy-failed",
  "validating",
  "completed",
  "cancelled",
] as const satisfies IssueStatus[]

type IssueRow = Tables<"issues">
type IssueRelationRow = Tables<"issue_relations">
type IssuePullRequestRow = Tables<"issue_pull_requests">

export type IssueRelationIssue = Pick<
  IssueRow,
  "id" | "number" | "title" | "status"
> & {
  projects: Pick<Tables<"projects">, "key"> | null
}

export type IssueRelation = Pick<
  IssueRelationRow,
  "id" | "source_issue_id" | "target_issue_id" | "created_at"
> & {
  type: "blocks"
  source_issue: IssueRelationIssue
  target_issue: IssueRelationIssue
}

export type IssuePullRequest = Pick<
  IssuePullRequestRow,
  "id" | "issue_id" | "url" | "created_at"
>

export type UserChatMessage = ChatMessageContract & {
  role: "user"
  kind: "text"
  status: "complete"
}

export function getIssueCode(projectKey: string, issueNumber: number) {
  return `${projectKey}-${issueNumber}`
}

export function isIssueBlockerResolved(status: string): boolean {
  return (RESOLVED_ISSUE_BLOCKER_STATUSES as readonly string[]).includes(
    status
  )
}
