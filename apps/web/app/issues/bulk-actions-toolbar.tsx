"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { IconChevronDown, IconTrash } from "@tabler/icons-react"
import { toast } from "sonner"

import { AgentProviderIcon } from "@/components/agent-provider-icon"
import type { IssuesData } from "@/app/queries"
import type { AssignedIssueLabel } from "@/app/query-contracts"
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
import {
  issuePriorityLabels,
  issuePriorityOptions,
  type AgentProvider,
  type IssuePriority,
  type IssueStatus,
} from "@gentic/validators/issues"

import {
  bulkAddIssueLabels,
  bulkDeleteIssues,
  bulkRemoveIssueLabels,
  bulkUpdateIssueAgentProvider,
  bulkUpdateIssuePriority,
  bulkUpdateIssueStatus,
} from "./actions"
import { BulkLabelPicker } from "./bulk-label-picker"
import {
  priorityIconStyles,
  priorityIcons,
  statusIconStyles,
  statusIcons,
  statusLabels,
  statusOptions,
} from "./issues-columns"
import { updateIssuesInCaches } from "./issues-cache"

const agentLabels: Record<AgentProvider, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
}

const agentOptions: {
  value: AgentProvider
  label: string
}[] = [
  { value: "claude_code", label: agentLabels.claude_code },
  { value: "codex", label: agentLabels.codex },
]

function pluralize(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

export function BulkActionsToolbar({
  selectedIds,
  labels,
  onDone,
}: {
  selectedIds: string[]
  labels: AssignedIssueLabel[]
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

  // Label assignment counts live only on the Settings > Labels page, driven
  // by a live join query — invalidating this prefix (rather than a single
  // key) covers every cached search variant so counts stay correct there
  // too if it's open in another tab/pane.
  async function invalidateLabelQueries() {
    await Promise.all([
      invalidateQueries(),
      queryClient.invalidateQueries({ queryKey: ["settings", "labels"] }),
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

  const priorityMutation = useMutation({
    mutationFn: bulkUpdateIssuePriority,
    onMutate: async (formData) => {
      const priority = formData.get("priority")

      if (typeof priority !== "string") {
        return
      }

      await Promise.all([
        queryClient.cancelQueries({ queryKey: queryKeys.issues }),
        queryClient.cancelQueries({ queryKey: queryKeys.home }),
      ])

      const previousIssues = queryClient.getQueryData<IssuesData>(
        queryKeys.issues
      )
      const previousHome = queryClient.getQueryData<IssuesData>(queryKeys.home)
      const selectedIdSet = new Set(selectedIds)

      updateIssuesInCaches(
        queryClient,
        (issue) => selectedIdSet.has(issue.id),
        (issue) => ({
          ...issue,
          priority: priority as IssuePriority,
        })
      )

      return { previousHome, previousIssues }
    },
    onSuccess: async (_data, formData) => {
      const priority = formData.get("priority")
      await invalidateQueries()
      onDone()
      toast.success(
        `Updated ${pluralize(count, "issue")} to ${
          typeof priority === "string"
            ? issuePriorityLabels[priority as IssuePriority]
            : "new priority"
        } priority`
      )
    },
    onError: (_error, _formData, context) => {
      if (context?.previousIssues) {
        queryClient.setQueryData(queryKeys.issues, context.previousIssues)
      }

      if (context?.previousHome) {
        queryClient.setQueryData(queryKeys.home, context.previousHome)
      }

      toast.error(`Failed to update priority for ${pluralize(count, "issue")}`)
    },
  })

  const agentMutation = useMutation({
    mutationFn: bulkUpdateIssueAgentProvider,
    onSuccess: async (_data, formData) => {
      const agentProvider = formData.get("agent_provider")
      await invalidateQueries()
      onDone()
      toast.success(
        `Updated ${pluralize(count, "issue")} to ${
          typeof agentProvider === "string"
            ? agentLabels[agentProvider as AgentProvider]
            : "new agent"
        }`
      )
    },
    onError: () => {
      toast.error(`Failed to update agent for ${pluralize(count, "issue")}`)
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

  const addLabelsMutation = useMutation({
    mutationFn: bulkAddIssueLabels,
    onSuccess: async () => {
      await invalidateLabelQueries()
      onDone()
      toast.success(`Added labels to ${pluralize(count, "issue")}`)
    },
    onError: () => {
      toast.error(`Failed to add labels to ${pluralize(count, "issue")}`)
    },
  })

  const removeLabelsMutation = useMutation({
    mutationFn: bulkRemoveIssueLabels,
    onSuccess: async () => {
      await invalidateLabelQueries()
      onDone()
      toast.success(`Removed labels from ${pluralize(count, "issue")}`)
    },
    onError: () => {
      toast.error(`Failed to remove labels from ${pluralize(count, "issue")}`)
    },
  })

  const isPending =
    statusMutation.isPending ||
    priorityMutation.isPending ||
    agentMutation.isPending ||
    deleteMutation.isPending ||
    addLabelsMutation.isPending ||
    removeLabelsMutation.isPending

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

  function setPriority(priority: IssuePriority) {
    if (count === 0 || priorityMutation.isPending) {
      return
    }

    const formData = new FormData()
    for (const id of selectedIds) {
      formData.append("id", id)
    }
    formData.set("priority", priority)
    priorityMutation.mutate(formData)
  }

  function setAgentProvider(agentProvider: AgentProvider) {
    if (count === 0 || agentMutation.isPending) {
      return
    }

    const formData = new FormData()
    for (const id of selectedIds) {
      formData.append("id", id)
    }
    formData.set("agent_provider", agentProvider)
    agentMutation.mutate(formData)
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

  // Add and remove submit the identical payload — the whole selection plus
  // the chosen label ids — so the only difference is which mutation runs.
  function mutateLabels(
    mutation: typeof addLabelsMutation,
    labelIds: string[]
  ) {
    if (count === 0 || labelIds.length === 0 || mutation.isPending) {
      return
    }

    const formData = new FormData()
    for (const id of selectedIds) {
      formData.append("issue_id", id)
    }
    for (const labelId of labelIds) {
      formData.append("label_id", labelId)
    }
    mutation.mutate(formData)
  }

  if (count === 0) {
    return null
  }

  return (
    // Wrapping (rather than a fixed row) keeps the toolbar's min-content width
    // down to a single button, so a narrow viewport doesn't get stretched by
    // the whole action row — the surrounding grid sizes to its widest child.
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-lg border bg-card px-4 py-2.5 shadow-sm">
      <span className="text-sm font-medium">
        {pluralize(count, "issue")} selected
      </span>
      <div className="flex flex-wrap items-center gap-2">
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={isPending}>
              Set priority
              <IconChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-52 rounded-lg bg-popover before:hidden"
          >
            {issuePriorityOptions.map((option) => {
              const OptionIcon = priorityIcons[option.value]

              return (
                <DropdownMenuItem
                  key={option.value}
                  disabled={priorityMutation.isPending}
                  onSelect={() => setPriority(option.value)}
                  className="gap-3"
                >
                  <OptionIcon
                    className={cn("size-4", priorityIconStyles[option.value])}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {option.label}
                  </span>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={isPending}>
              Set agent
              <IconChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-48 rounded-lg bg-popover before:hidden"
          >
            {agentOptions.map((option) => {
              return (
                <DropdownMenuItem
                  key={option.value}
                  disabled={agentMutation.isPending}
                  onSelect={() => setAgentProvider(option.value)}
                  className="gap-3"
                >
                  <AgentProviderIcon
                    provider={option.value}
                    className="size-4"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {option.label}
                  </span>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <BulkLabelPicker
          idPrefix="add"
          triggerLabel="Add labels"
          emptyLabel={labels.length === 0 ? "No labels yet." : "No matches."}
          applyLabel={(n) => `Add ${pluralize(n, "label")}`}
          labels={labels}
          disabled={isPending}
          pending={addLabelsMutation.isPending}
          onApply={(labelIds) => mutateLabels(addLabelsMutation, labelIds)}
        />
        <BulkLabelPicker
          idPrefix="remove"
          triggerLabel="Remove labels"
          emptyLabel={labels.length === 0 ? "No labels yet." : "No matches."}
          applyLabel={(n) => `Remove ${pluralize(n, "label")}`}
          labels={labels}
          disabled={isPending}
          pending={removeLabelsMutation.isPending}
          onApply={(labelIds) => mutateLabels(removeLabelsMutation, labelIds)}
        />
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
                This will permanently delete the selected{" "}
                {count === 1 ? "issue" : "issues"}. This action cannot be
                undone.
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
