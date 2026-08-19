import { isSpecIssueType } from "@gentic/validators/issues"
import type { IssueStatus } from "@gentic/validators/issues"

/**
 * Whether the issue detail menu should offer **Reset** — the destructive
 * `resetIssueAgent` path that wipes the conversation and pull-request links,
 * then re-queues the issue on a fresh kickoff message.
 *
 * Two kinds of issue have nothing to reset. A Spec never runs an agent, and
 * the service rejects the call outright. A draft has not started either, and
 * because the reset lands the issue in `todo` the action would *begin* the run
 * rather than restart it — the opposite of what the word promises.
 */
export function canResetIssue(input: {
  status: IssueStatus
  type: string | null
}) {
  return input.status !== "draft" && !isSpecIssueType(input.type)
}
