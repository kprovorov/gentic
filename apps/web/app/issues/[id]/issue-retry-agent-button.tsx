"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { IconChevronDown, IconRefresh } from "@tabler/icons-react"

import { Button } from "@gentic/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@gentic/ui/dropdown-menu"

import { resetIssueAgent } from "@/app/issues/actions"
import { queryKeys } from "@/app/query-keys"

type AgentProvider = "claude_code" | "codex"

const agentOptions: Array<{ value: AgentProvider; label: string }> = [
  { value: "claude_code", label: "Claude Code" },
  { value: "codex", label: "Codex" },
]

export function IssueRetryAgentButton({ issueId }: { issueId: string }) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: resetIssueAgent,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.issue(issueId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues }),
      ])
    },
  })

  function handleRetry(agentProvider: AgentProvider) {
    if (mutation.isPending) {
      return
    }

    const agentLabel =
      agentOptions.find((option) => option.value === agentProvider)?.label ??
      "the selected agent"

    if (
      !window.confirm(
        `Retry with ${agentLabel}? This deletes the conversation and starts a fresh run.`
      )
    ) {
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
          {agentOptions
            .filter((option) => option.value !== "claude_code")
            .map((option) => (
              <DropdownMenuItem key={option.value} asChild>
                <button
                  type="button"
                  className="w-full"
                  onClick={() => handleRetry(option.value)}
                >
                  Retry with {option.label}
                </button>
              </DropdownMenuItem>
            ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
