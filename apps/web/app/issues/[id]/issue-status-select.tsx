"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { updateIssueStatus } from "@/app/issues/actions"
import { queryKeys } from "@/app/query-keys"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@gentic/ui/select"

type IssueStatus =
  | "draft"
  | "todo"
  | "queued"
  | "held"
  | "in-progress"
  | "waiting-for-input"
  | "testing"
  | "tests-failed"
  | "ready-for-review"
  | "changes-requested"
  | "approved"
  | "merged"
  | "deploying"
  | "deploy-failed"
  | "validating"
  | "run-failed"
  | "completed"
  | "cancelled"

const statusOptions: { value: IssueStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "todo", label: "To do" },
  { value: "queued", label: "Queued" },
  { value: "held", label: "On hold" },
  { value: "in-progress", label: "In progress" },
  { value: "waiting-for-input", label: "Waiting for input" },
  { value: "testing", label: "Testing" },
  { value: "tests-failed", label: "Tests failed" },
  { value: "ready-for-review", label: "Ready for review" },
  { value: "changes-requested", label: "Changes requested" },
  { value: "approved", label: "Approved" },
  { value: "merged", label: "Merged" },
  { value: "deploying", label: "Deploying" },
  { value: "deploy-failed", label: "Deploy failed" },
  { value: "validating", label: "Validating" },
  { value: "run-failed", label: "Run failed" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
]

export function IssueStatusSelect({
  issueId,
  status,
}: {
  issueId: string
  status: IssueStatus
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
      <Select
        value={status}
        onValueChange={handleValueChange}
        disabled={mutation.isPending}
      >
        <SelectTrigger id="issue-status" className="max-w-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {statusOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
