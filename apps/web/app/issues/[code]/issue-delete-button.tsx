"use client"

import { useTransition } from "react"
import { IconTrash } from "@tabler/icons-react"

import { Button } from "@gentic/ui/button"

import { deleteIssue } from "@/app/issues/actions"

export function useIssueDelete(issueId: string) {
  const [isPending, startTransition] = useTransition()

  function handleDelete() {
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

  return { isPending, handleDelete }
}

export function IssueDeleteButton({ issueId }: { issueId: string }) {
  const { isPending, handleDelete } = useIssueDelete(issueId)

  return (
    <Button
      type="button"
      variant="destructive"
      onClick={handleDelete}
      disabled={isPending}
    >
      <IconTrash />
      Delete
    </Button>
  )
}
