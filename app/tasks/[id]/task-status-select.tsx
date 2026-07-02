"use client"

import { useTransition } from "react"

import { updateTaskStatus } from "@/app/tasks/actions"

type TaskStatus = "todo" | "in-progress" | "done"

const statusOptions: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "Todo" },
  { value: "in-progress", label: "In progress" },
  { value: "done", label: "Done" },
]

export function TaskStatusSelect({
  taskId,
  status,
}: {
  taskId: string
  status: TaskStatus
}) {
  const [isPending, startTransition] = useTransition()

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const nextStatus = event.target.value
    if (nextStatus === status) {
      return
    }

    const formData = new FormData()
    formData.set("id", taskId)
    formData.set("status", nextStatus)
    startTransition(() => {
      void updateTaskStatus(formData)
    })
  }

  return (
    <div className="grid gap-2">
      <label
        htmlFor="task-status"
        className="text-sm font-medium text-muted-foreground"
      >
        Status
      </label>
      <select
        id="task-status"
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
