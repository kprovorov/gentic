"use client"

import { useTransition } from "react"

import { updateIssueStatus } from "@/app/issues/actions"

type IssueStatus =
  | "draft"
  | "todo"
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
  | "completed"

const statusOptions: { value: IssueStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "todo", label: "Todo" },
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
  { value: "completed", label: "Completed" },
]

export function IssueStatusSelect({
  issueId,
  status,
}: {
  issueId: string
  status: IssueStatus
}) {
  const [isPending, startTransition] = useTransition()

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextStatus = event.target.value
    if (nextStatus === status) {
      return
    }

    const formData = new FormData()
    formData.set("id", issueId)
    formData.set("status", nextStatus)
    startTransition(() => {
      void updateIssueStatus(formData)
    })
  }

  return (
    <div className="grid gap-2">
      <label
        htmlFor="issue-status"
        className="text-sm font-medium text-muted-foreground"
      >
        Status
      </label>
      <select
        id="issue-status"
        name="status"
        value={status}
        onChange={handleChange}
        disabled={isPending}
        className="h-9 w-full max-w-xs rounded-3xl border border-transparent bg-input/50 px-3 text-sm transition-[color,box-shadow,background-color] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-70"
      >
        {statusOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  )
}
