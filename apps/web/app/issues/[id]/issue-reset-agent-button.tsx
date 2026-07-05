"use client"

import { useTransition } from "react"
import { IconRefresh } from "@tabler/icons-react"

import { Button } from "@gentic/ui/button"

import { resetIssueAgent } from "@/app/issues/actions"

export function IssueResetAgentButton({ issueId }: { issueId: string }) {
  const [isPending, startTransition] = useTransition()

  function handleClick() {
    if (isPending) {
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
    startTransition(() => {
      void resetIssueAgent(formData)
    })
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleClick}
      disabled={isPending}
    >
      <IconRefresh />
      Reset Agent
    </Button>
  )
}
