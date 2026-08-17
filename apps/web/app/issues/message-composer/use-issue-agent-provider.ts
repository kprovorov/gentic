"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { resetIssueAgent, updateIssueAgentProvider } from "@/app/issues/actions"
import { queryKeys } from "@/app/query-keys"
import type { AgentProvider, IssueModel } from "@gentic/validators/issues"

import {
  ISSUE_RETRY_RESET_EVENT,
  type IssueRetryResetEventDetail,
} from "../[code]/issue-retry-events"

// Wires MessageComposer's onAgentModelChange to the two existing agent
// endpoints: a plain field update before any run has started, or the same
// destructive resetIssueAgent path once a conversation exists. Kept separate
// from MessageComposer itself, which stays issue-agnostic (see
// MessageComposer's prop contract).
export function useIssueAgentProvider({ issueId }: { issueId: string }) {
  const queryClient = useQueryClient()

  const resetMutation = useMutation({
    mutationFn: resetIssueAgent,
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
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues }),
      ])
    },
  })

  const updateMutation = useMutation({
    mutationFn: updateIssueAgentProvider,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.issue(issueId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues }),
      ])
    },
  })

  function onAgentModelChange(
    agentProvider: AgentProvider,
    issueModel: IssueModel,
    { requiresReset }: { requiresReset: boolean }
  ) {
    if (resetMutation.isPending || updateMutation.isPending) {
      return
    }

    const formData = new FormData()
    formData.set("id", issueId)
    formData.set("agent_provider", agentProvider)
    formData.set("issue_model", issueModel ?? "")

    if (requiresReset) {
      resetMutation.mutate(formData)
      return
    }

    updateMutation.mutate(formData)
  }

  return {
    onAgentModelChange,
    isPending: resetMutation.isPending || updateMutation.isPending,
  }
}
