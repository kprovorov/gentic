import type { Tables } from "@gentic/supabase/types"
import type { ChatMessageContract } from "@gentic/validators/realtime"

export const ISSUE_WITH_PROJECT_SELECT = "*, projects!inner(id,name,repo,user_id)"

type IssueRow = Tables<"issues">
type IssueRelationRow = Tables<"issue_relations">
type IssuePullRequestRow = Tables<"issue_pull_requests">

export type IssueRelationIssue = Pick<IssueRow, "id" | "title" | "status">

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
