import type { IssueStatus } from "@gentic/validators/issues"

const finishedAgentStatuses = new Set<IssueStatus>([
  "waiting-for-input",
  "tests-failed",
  "ready-for-review",
  "run-failed",
])

export function canShowManualCreatePrAction(input: {
  status: IssueStatus
  hasUnpublishedAgentChanges: boolean
  hasAttachedPullRequest: boolean
  automaticPublishingInProgress: boolean
}) {
  return (
    finishedAgentStatuses.has(input.status) &&
    input.hasUnpublishedAgentChanges &&
    !input.hasAttachedPullRequest &&
    !input.automaticPublishingInProgress
  )
}
