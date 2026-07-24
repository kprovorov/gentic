"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { IconChevronDown, IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"

import { queryKeys } from "@/app/query-keys"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@gentic/ui/alert-dialog"
import { Button } from "@gentic/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@gentic/ui/dropdown-menu"
import { cn } from "@gentic/ui/utils"
import type { IssueStatus } from "@gentic/validators/issues"

import { bulkDeleteIssues, bulkUpdateIssueStatus } from "./actions"
import { statusIconStyles, statusIcons, statusLabels, statusOptions } from "./issues-columns"

function pluralize(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

export function BulkActionsToolbar({
  selectedIds,
  onDone,
}: {
  selectedIds: string[]
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const count = selectedIds.length

  async function invalidateQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.home }),
      queryClient.invalidateQueries({ queryKey: queryKeys.issues }),
    ])
  }

  const statusMutation = useMutation({
    mutationFn: bulkUpdateIssueStatus,
    onSuccess: async (_data, formData) => {
      const status = formData.get("status")
      await invalidateQueries()
      onDone()
      toast.success(
        `Updated ${pluralize(count, "issue")} to ${
          typeof status === "string"
            ? statusLabels[status as IssueStatus]
            : "new status"
        }`
      )
    },
    onError: () => {
      toast.error(`Failed to update ${pluralize(count, "issue")}`)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: bulkDeleteIssues,
    onSuccess: async () => {
      await invalidateQueries()
      setDeleteDialogOpen(false)
      onDone()
      toast.success(`Deleted ${pluralize(count, "issue")}`)
    },
    onError: () => {
      toast.error(`Failed to delete ${pluralize(count, "issue")}`)
    },
  })

  const isPending = statusMutation.isPending || deleteMutation.isPending

  function setStatus(status: IssueStatus) {
    if (count === 0 || statusMutation.isPending) {
      return
    }

    const formData = new FormData()
    for (const id of selectedIds) {
      formData.append("id", id)
    }
    formData.set("status", status)
    statusMutation.mutate(formData)
  }

  function confirmDelete() {
    if (count === 0 || deleteMutation.isPending) {
      return
    }

    const formData = new FormData()
    for (const id of selectedIds) {
      formData.append("id", id)
    }
    deleteMutation.mutate(formData)
  }

  if (count === 0) {
    return null
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border bg-card px-4 py-2.5 shadow-sm">
      <span className="text-sm font-medium">{pluralize(count, "issue")} selected</span>
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={isPending}>
              Set status
              <IconChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-60 rounded-lg bg-popover before:hidden"
          >
            {statusOptions.map((option) => {
              const OptionIcon = statusIcons[option.value]

              return (
                <DropdownMenuItem
                  key={option.value}
                  disabled={statusMutation.isPending}
                  onSelect={() => setStatus(option.value)}
                  className="gap-3"
                >
                  <OptionIcon
                    className={cn("size-4", statusIconStyles[option.value])}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {option.label}
                  </span>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" disabled={isPending}>
              <IconTrash />
              Delete
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete {pluralize(count, "issue")}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete the selected {count === 1 ? "issue" : "issues"}.
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteMutation.isPending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={deleteMutation.isPending}
                onClick={(event) => {
                  event.preventDefault()
                  confirmDelete()
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
