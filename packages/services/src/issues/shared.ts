export const ISSUE_WITH_PROJECT_SELECT = "*, projects!inner(id,name,repo,user_id)"

export type IssueRelationIssue = {
  id: string
  title: string | null
  status: string
}

export type IssueRelation = {
  id: string
  source_issue_id: string
  target_issue_id: string
  type: "blocks"
  created_at: string
  source_issue: IssueRelationIssue
  target_issue: IssueRelationIssue
}

export type IssuePullRequest = {
  id: string
  issue_id: string
  url: string
  created_at: string
}

export function kickoffMessageContent(prompt: string | null): string {
  return prompt ?? ""
}
