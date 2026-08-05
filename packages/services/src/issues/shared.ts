import type { Tables } from "@gentic/supabase/types"
import type { ChatMessageContract } from "@gentic/validators/realtime"

export const ISSUE_WITH_PROJECT_SELECT =
  "*, projects!inner(id,name,repo,user_id,key)"

export const ISSUE_WITH_PROJECT_AND_LABELS_SELECT =
  "*, projects!inner(id,name,repo,user_id,key), issue_labels(labels!inner(id,name,color,state))"

export type AssignedIssueLabel = {
  id: string
  name: string
  color: string
}

type IssueLabelJoin = {
  labels: AssignedIssueLabel & { state: string }
}

export function withActiveAssignedLabels<
  T extends { issue_labels?: IssueLabelJoin[] },
>(row: T): Omit<T, "issue_labels"> & { labels: AssignedIssueLabel[] } {
  const { issue_labels: issueLabelRows = [], ...issue } = row
  const labels = issueLabelRows
    .map((assignment) => assignment.labels)
    .filter((label) => label.state === "active")
    .map(({ id, name, color }) => ({ id, name, color }))
    .toSorted((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    )

  return { ...issue, labels }
}

type IssueRow = Tables<"issues">
type IssueAutomaticPrRequestRow = Tables<"issue_automatic_pr_requests">
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
  "id" | "issue_id" | "url" | "created_at" | "state"
>

export type IssueAutomaticPrRequest = Pick<
  IssueAutomaticPrRequestRow,
  | "id"
  | "issue_id"
  | "run_id"
  | "requested_by_message_id"
  | "create_pr_automatically_snapshot"
  | "status"
  | "error"
  | "created_at"
  | "updated_at"
>

export type UserChatMessage = ChatMessageContract & {
  role: "user"
  kind: "text"
  status: "complete"
}

export function getIssueCode(projectKey: string, issueNumber: number) {
  return `${projectKey}-${issueNumber}`
}
