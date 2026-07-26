"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { IconChevronDown, IconRefresh } from "@tabler/icons-react"

import { AgentProviderIcon } from "@/components/agent-provider-icon"
import { Button } from "@gentic/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@gentic/ui/dropdown-menu"
import type { AgentProvider } from "@gentic/validators/issues"

import { resetIssueAgent } from "@/app/issues/actions"
import { queryKeys } from "@/app/query-keys"

import {
  agentProviderLabels,
  agentProviderOptions,
  confirmRetryWithAgent,
} from "../agent-provider-options"
import {
  ISSUE_RETRY_RESET_EVENT,
  type IssueRetryResetEventDetail,
} from "./issue-retry-events"

export function IssueRetryAgentButton({ issueId }: { issueId: string }) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: resetIssueAgent,
    onSuccess: async (message) => {
      window.dispatchEvent(
        new CustomEvent<IssueRetryResetEventDetail>(ISSUE_RETRY_RESET_EVENT, {
          detail: {
            issueId,
            message,
            status: "todo",
            usageLimitResetAt: null,
            prUrl: null,
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

  function handleRetry(agentProvider: AgentProvider) {
    if (mutation.isPending) {
      return
    }

    if (!confirmRetryWithAgent(agentProviderLabels[agentProvider])) {
      return
    }

    const formData = new FormData()
    formData.set("id", issueId)
    formData.set("agent_provider", agentProvider)
    mutation.mutate(formData)
  }

  return (
    <div className="flex items-center">
      <Button
        type="button"
        variant="outline"
        onClick={() => handleRetry("claude_code")}
        disabled={mutation.isPending}
        className="rounded-r-none border-r-border/60"
      >
        <IconRefresh />
        Retry with Claude Code
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            aria-label="Choose retry agent"
            disabled={mutation.isPending}
            className="rounded-l-none border-l-0 px-2"
          >
            <IconChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {agentProviderOptions
            .filter((option) => option.value !== "claude_code")
            .map((option) => (
              <DropdownMenuItem key={option.value} asChild>
                <button
                  type="button"
                  className="w-full"
                  onClick={() => handleRetry(option.value)}
                >
                  <AgentProviderIcon
                    provider={option.value}
                    className="size-4"
                  />
                  Retry with {option.label}
                </button>
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
