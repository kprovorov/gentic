"use client"

import type { IssueDetail } from "@/app/queries"
import type { IssueStatus } from "@gentic/validators/issues"

import { IssueAgentSelect } from "./issue-agent-select"
import { IssueStatusSelect } from "./issue-status-select"

export function IssueStatusControls({
  issueId,
  status,
  agentProvider,
  disabled,
}: {
  issueId: string
  status: IssueStatus
  agentProvider: IssueDetail["agent_provider"]
  disabled: boolean
}) {
  return (
    <>
      <IssueStatusSelect issueId={issueId} status={status} />
      <IssueAgentSelect
        issueId={issueId}
        agentProvider={agentProvider}
        disabled={disabled}
      />
    </>
  )
}
