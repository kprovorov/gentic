import type { Tables } from "@gentic/supabase/types"
import type { ChatMessageContract } from "@gentic/validators/realtime"

const ISSUE_SELECT =
  "id,project_id,number,title,body,status,type,priority,agent_provider,issue_model,session_id,active_run_id,active_worker_id,run_started_at,run_finished_at,run_error,usage_limit_reset_at,create_pr_automatically,has_unpublished_agent_changes,created_at,updated_at"

export const ISSUE_WITH_PROJECT_SELECT = `${ISSUE_SELECT}, projects!inner(id,name,repo,user_id,key)`

export const ISSUE_WITH_PROJECT_AND_LABELS_SELECT =
  `${ISSUE_SELECT}, projects!inner(id,name,repo,user_id,key), issue_labels(labels!inner(id,name,color,state))`

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

/**
 * The fixed Kickoff Message that opens a fresh Coding Agent conversation. It
 * names the Issue Code and nothing else — no title, Body excerpt, or hidden
 * instruction — because the agent reads the Body itself through the Gentic MCP
 * `get_issue` tool. Kept identical to the wording seeded by the
 * `issue_kickoff_message` SQL function so every creation path matches.
 */
export function formatIssueKickoffMessage(issueCode: string) {
  return `Work on Gentic issue ${issueCode}.`
}

/**
 * Parse a human-readable Issue Code such as `GEN-123` into its project key and
 * issue number, the inverse of {@link getIssueCode}. Returns `null` for any
 * malformed input so callers can surface an ordinary not-found error without
 * leaking whether a project or issue exists.
 */
export function parseIssueCode(code: string) {
  const match = /^([A-Z][A-Z0-9]*)-(\d+)$/.exec(code.trim().toUpperCase())
  if (!match) return null

  const issueNumber = Number.parseInt(match[2], 10)
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) return null

  return {
    projectKey: match[1],
    issueNumber,
  }
}
