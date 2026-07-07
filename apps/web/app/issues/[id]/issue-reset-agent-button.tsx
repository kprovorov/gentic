"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { IconRefresh } from "@tabler/icons-react"

import { Button } from "@gentic/ui/button"

import { resetIssueAgent } from "@/app/issues/actions"
import { queryKeys } from "@/app/query-keys"

export function IssueResetAgentButton({ issueId }: { issueId: string }) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: resetIssueAgent,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.issue(issueId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
      ])
    },
  })

  function handleClick() {
    if (mutation.isPending) {
      return
    }

    if (
      !window.confirm(
        "Reset the agent for this issue? This deletes the conversation and starts a fresh run."
      )
    ) {
      return
    }

    const formData = new FormData()
    formData.set("id", issueId)
    mutation.mutate(formData)
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleClick}
      disabled={mutation.isPending}
    >
      <IconRefresh />
      Reset Agent
    </Button>
  )
}
