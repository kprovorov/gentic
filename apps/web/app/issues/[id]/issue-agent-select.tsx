"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { updateIssueAgentProvider } from "@/app/issues/actions"
import { queryKeys } from "@/app/query-keys"
import { NativeSelect, NativeSelectOption } from "@gentic/ui/native-select"

type AgentProvider = "claude_code" | "codex"

const agentOptions: { value: AgentProvider; label: string }[] = [
  { value: "claude_code", label: "Claude Code" },
  { value: "codex", label: "Codex" },
]

export function IssueAgentSelect({
  issueId,
  agentProvider,
  disabled,
}: {
  issueId: string
  agentProvider: AgentProvider
  disabled: boolean
}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: updateIssueAgentProvider,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.issue(issueId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues }),
      ])
    },
  })

  function handleValueChange(nextAgentProvider: string) {
    if (
      nextAgentProvider === agentProvider ||
      disabled ||
      mutation.isPending
    ) {
      return
    }

    const formData = new FormData()
    formData.set("id", issueId)
    formData.set("agent_provider", nextAgentProvider)
    mutation.mutate(formData)
  }

  return (
    <div className="grid gap-2">
      <label
        htmlFor="issue-agent-provider"
        className="text-sm font-medium text-muted-foreground"
      >
        Agent
      </label>
      <NativeSelect
        value={agentProvider}
        onChange={(event) => handleValueChange(event.target.value)}
        disabled={disabled || mutation.isPending}
        id="issue-agent-provider"
        className="w-full max-w-xs"
        title={
          disabled ? "Agent cannot be changed after an issue starts" : undefined
        }
      >
        {agentOptions.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  )
}
