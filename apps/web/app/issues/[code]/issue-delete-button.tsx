"use client"

import { useTransition } from "react"
import { IconTrash } from "@tabler/icons-react"

import { Button } from "@gentic/ui/button"

import { deleteIssue } from "@/app/issues/actions"

export function IssueDeleteButton({ issueId }: { issueId: string }) {
  const [isPending, startTransition] = useTransition()

  function handleClick() {
    if (isPending) {
      return
    }

    if (!window.confirm("Delete this issue? This cannot be undone.")) {
      return
    }

    const formData = new FormData()
    formData.set("id", issueId)
    startTransition(() => {
      void deleteIssue(formData)
    })
  }

  return (
    <Button
      type="button"
      variant="destructive"
      onClick={handleClick}
      disabled={isPending}
    >
      <IconTrash />
      Delete
    </Button>
  )
}
