"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { updateIssueStatus } from "@/app/issues/actions"
import { statusOptions } from "@/app/issues/issues-columns"
import { queryKeys } from "@/app/query-keys"
import { NativeSelect, NativeSelectOption } from "@gentic/ui/native-select"

export function IssueStatusSelect({
  issueId,
  status,
}: {
  issueId: string
  status: (typeof statusOptions)[number]["value"]
}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: updateIssueStatus,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.issue(issueId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues }),
      ])
    },
  })

  function handleValueChange(nextStatus: string) {
    if (nextStatus === status || mutation.isPending) {
      return
    }

    const formData = new FormData()
    formData.set("id", issueId)
    formData.set("status", nextStatus)
    mutation.mutate(formData)
  }

  return (
    <div className="grid gap-2">
      <label
        htmlFor="issue-status"
        className="text-sm font-medium text-muted-foreground"
      >
        Status
      </label>
      <NativeSelect
        value={status}
        onChange={(event) => handleValueChange(event.target.value)}
        disabled={mutation.isPending}
        id="issue-status"
        className="w-full max-w-xs"
      >
        {statusOptions.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  )
}
