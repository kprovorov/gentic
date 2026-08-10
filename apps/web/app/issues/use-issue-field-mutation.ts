"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import type { HomeIssue, IssueDetailData, IssuesData } from "@/app/queries"
import { queryKeys } from "@/app/query-keys"

import { updateIssuesInCaches } from "./issues-cache"

/** Issue columns the inline dropdown menus can edit. */
type EditableIssueField = "priority" | "status" | "type"

type IssueFieldMutationOptions<Field extends EditableIssueField> = {
  issueId: string
  /** The form field the server action reads, and the column it writes. */
  field: Field
  /** Current value, so re-picking it is a no-op instead of a round trip. */
  value: HomeIssue[Field]
  action: (formData: FormData) => Promise<unknown>
  errorMessage: string
  /**
   * Also patch and invalidate the issue detail caches. Only worth doing for
   * fields the detail page renders.
   */
  syncsDetail?: boolean
}

/**
 * Optimistically writes one issue field to every cache that renders it,
 * rolling back and surfacing a toast if the server action fails.
 */
export function useIssueFieldMutation<Field extends EditableIssueField>({
  issueId,
  field,
  value,
  action,
  errorMessage,
  syncsDetail = false,
}: IssueFieldMutationOptions<Field>) {
  const queryClient = useQueryClient()
  const detailKey = queryKeys.issue(issueId)

  const mutation = useMutation({
    mutationFn: (nextValue: HomeIssue[Field]) => {
      const formData = new FormData()
      formData.set("id", issueId)
      formData.set(field, nextValue)

      return action(formData)
    },
    onMutate: async (nextValue) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: queryKeys.issues }),
        queryClient.cancelQueries({ queryKey: queryKeys.home }),
        ...(syncsDetail
          ? [queryClient.cancelQueries({ queryKey: detailKey })]
          : []),
      ])

      const previous = {
        issues: queryClient.getQueryData<IssuesData>(queryKeys.issues),
        home: queryClient.getQueryData<IssuesData>(queryKeys.home),
        detail: syncsDetail
          ? queryClient.getQueryData<IssueDetailData>(detailKey)
          : undefined,
      }
      // A computed key over a generic field widens to an index signature, so
      // restate the patch as the single-property slice it actually is.
      const patch = { [field]: nextValue } as unknown as Pick<HomeIssue, Field>

      updateIssuesInCaches(
        queryClient,
        (issue) => issue.id === issueId,
        (issue) => ({ ...issue, ...patch })
      )

      if (syncsDetail) {
        queryClient.setQueryData<IssueDetailData>(detailKey, (current) =>
          current
            ? { ...current, issue: { ...current.issue, ...patch } }
            : current
        )
      }

      return previous
    },
    onError: (_error, _nextValue, previous) => {
      if (previous?.issues) {
        queryClient.setQueryData(queryKeys.issues, previous.issues)
      }

      if (previous?.home) {
        queryClient.setQueryData(queryKeys.home, previous.home)
      }

      if (previous?.detail) {
        queryClient.setQueryData(detailKey, previous.detail)
      }

      toast.error(errorMessage)
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues }),
        ...(syncsDetail
          ? [
              queryClient.invalidateQueries({ queryKey: detailKey }),
              queryClient.invalidateQueries({
                queryKey: queryKeys.issueEdit(issueId),
              }),
            ]
          : []),
      ])
    },
  })

  return {
    isPending: mutation.isPending,
    select(nextValue: HomeIssue[Field]) {
      if (nextValue === value || mutation.isPending) {
        return
      }

      mutation.mutate(nextValue)
    },
  }
}
