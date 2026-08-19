"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { resetIssueAgent } from "@/app/issues/actions"
import { queryKeys } from "@/app/query-keys"
import type { AgentProvider, IssueModel } from "@gentic/validators/issues"

import {
  ISSUE_RETRY_RESET_EVENT,
  type IssueRetryResetEventDetail,
} from "./issue-retry-events"

export const RESET_ISSUE_CONFIRM_MESSAGE =
  "Reset this issue? This deletes the conversation and its pull-request links, then re-queues a fresh run."

/**
 * The issue menu's **Reset** action. It runs the same destructive path the
 * composer's agent switch does, minus the switch: the agent and model are
 * carried over so the run restarts as the issue is already configured.
 */
export function useIssueReset({
  issueId,
  agentProvider,
  issueModel,
}: {
  issueId: string
  agentProvider: AgentProvider
  issueModel: IssueModel
}) {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: resetIssueAgent,
    // The open transcript belongs to the run that was just wiped, so clear it
    // here rather than waiting for a refetch to contradict it — the same
    // handover the composer's agent switch uses.
    onSuccess: async (message) => {
      window.dispatchEvent(
        new CustomEvent<IssueRetryResetEventDetail>(ISSUE_RETRY_RESET_EVENT, {
          detail: {
            issueId,
            message,
            status: "todo",
            usageLimitResetAt: null,
            pullRequests: [],
          },
        })
      )

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.issue(issueId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues }),
      ])
    },
  })

  function handleReset() {
    if (mutation.isPending) {
      return
    }

    if (!window.confirm(RESET_ISSUE_CONFIRM_MESSAGE)) {
      return
    }

    const formData = new FormData()
    formData.set("id", issueId)
    formData.set("agent_provider", agentProvider)
    formData.set("issue_model", issueModel ?? "")

    mutation.mutate(formData)
  }

  return { isPending: mutation.isPending, handleReset }
}
