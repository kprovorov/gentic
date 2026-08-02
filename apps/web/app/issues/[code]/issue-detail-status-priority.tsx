"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { IconCheck, IconChevronDown } from "@tabler/icons-react"
import { toast } from "sonner"

import { updateIssuePriority, updateIssueStatus } from "@/app/issues/actions"
import {
  issuePriorityIcons,
  issuePriorityLabels,
  issuePriorityOptions,
  issuePriorityStyles,
} from "@/app/issues/issue-priority-meta"
import {
  priorityIconStyles,
  statusIconStyles,
  statusIcons,
  statusLabels,
  statusOptions,
} from "@/app/issues/issues-columns"
import { queryKeys } from "@/app/query-keys"
import type { HomeData, IssueDetailData } from "@/app/queries"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@gentic/ui/dropdown-menu"
import { cn } from "@gentic/ui/utils"
import type { IssuePriority, IssueStatus } from "@gentic/validators/issues"

export function IssueDetailStatus({
  issueId,
  status,
  variant = "block",
}: {
  issueId: string
  status: IssueStatus
  variant?: "block" | "pill"
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

  function selectStatus(nextStatus: IssueStatus) {
    if (nextStatus === status || mutation.isPending) {
      return
    }

    const formData = new FormData()
    formData.set("id", issueId)
    formData.set("status", nextStatus)
    mutation.mutate(formData)
  }

  const StatusIcon = statusIcons[status]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={mutation.isPending}
          aria-label={`Change status from ${statusLabels[status]}`}
          className={cn(
            "flex h-9 items-center gap-2.5 rounded-2xl border border-border bg-background px-3 text-[13px] text-foreground transition-[color,box-shadow,background-color] hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=open]:ring-2 data-[state=open]:ring-ring/30",
            variant === "block" ? "w-full" : "w-auto"
          )}
        >
          <StatusIcon
            className={cn("size-[15px] shrink-0", statusIconStyles[status])}
          />
          <span className="min-w-0 flex-1 truncate text-left">
            {statusLabels[status]}
          </span>
          <IconChevronDown className="size-[15px] shrink-0 opacity-65" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {statusOptions.map((option) => {
          const OptionIcon = statusIcons[option.value]
          const isSelected = option.value === status

          return (
            <DropdownMenuItem
              key={option.value}
              disabled={mutation.isPending}
              onSelect={() => selectStatus(option.value)}
              className="gap-3"
            >
              <OptionIcon
                className={cn("size-4", statusIconStyles[option.value])}
              />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {isSelected ? <IconCheck className="size-4" /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function IssueDetailPriority({
  issueId,
  priority,
  variant = "block",
}: {
  issueId: string
  priority: IssuePriority
  variant?: "block" | "pill"
}) {
  const queryClient = useQueryClient()
  const [optimisticPriority, setOptimisticPriority] =
    useState<IssuePriority | null>(null)
  const displayedPriority = optimisticPriority ?? priority
  const mutation = useMutation({
    mutationFn: updateIssuePriority,
    onMutate: async (formData) => {
      const nextPriority = formData.get("priority")

      if (typeof nextPriority !== "string") {
        return
      }

      const priorityValue = nextPriority as IssuePriority
      const previousOptimisticPriority = optimisticPriority
      setOptimisticPriority(priorityValue)

      await Promise.all([
        queryClient.cancelQueries({ queryKey: queryKeys.issue(issueId) }),
        queryClient.cancelQueries({ queryKey: queryKeys.home }),
        queryClient.cancelQueries({ queryKey: queryKeys.issues }),
      ])

      const previousIssue = queryClient.getQueryData<IssueDetailData>(
        queryKeys.issue(issueId)
      )
      const previousHome = queryClient.getQueryData<HomeData>(queryKeys.home)
      const previousIssues = queryClient.getQueryData<HomeData>(
        queryKeys.issues
      )
      const updateListData = (current: HomeData | undefined) =>
        current
          ? {
              ...current,
              issues: current.issues.map((currentIssue) =>
                currentIssue.id === issueId
                  ? { ...currentIssue, priority: priorityValue }
                  : currentIssue
              ),
            }
          : current

      queryClient.setQueryData<IssueDetailData>(
        queryKeys.issue(issueId),
        (current) =>
          current
            ? {
                ...current,
                issue: { ...current.issue, priority: priorityValue },
              }
            : current
      )
      queryClient.setQueryData(queryKeys.home, updateListData)
      queryClient.setQueryData(queryKeys.issues, updateListData)

      return {
        previousHome,
        previousIssue,
        previousIssues,
        previousOptimisticPriority,
      }
    },
    onError: (_error, _formData, context) => {
      if (context) {
        setOptimisticPriority(context.previousOptimisticPriority)
      }

      if (context?.previousIssue) {
        queryClient.setQueryData(
          queryKeys.issue(issueId),
          context.previousIssue
        )
      }

      if (context?.previousHome) {
        queryClient.setQueryData(queryKeys.home, context.previousHome)
      }

      if (context?.previousIssues) {
        queryClient.setQueryData(queryKeys.issues, context.previousIssues)
      }

      toast.error("Failed to update issue priority")
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.issue(issueId) }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.issueEdit(issueId),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues }),
      ])
      setOptimisticPriority(null)
    },
  })

  function selectPriority(nextPriority: IssuePriority) {
    if (nextPriority === displayedPriority || mutation.isPending) {
      return
    }

    const formData = new FormData()
    formData.set("id", issueId)
    formData.set("priority", nextPriority)
    mutation.mutate(formData)
  }

  const PriorityIcon = issuePriorityIcons[displayedPriority]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={mutation.isPending}
          aria-label={`Change priority from ${issuePriorityLabels[displayedPriority]}`}
          className={cn(
            "flex h-9 items-center gap-2.5 rounded-2xl border px-3 text-[13px] transition-[color,box-shadow,background-color] hover:ring-2 hover:ring-ring/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=open]:ring-2 data-[state=open]:ring-ring/30",
            issuePriorityStyles[displayedPriority],
            variant === "block" ? "w-full" : "w-auto"
          )}
        >
          <PriorityIcon
            className={cn(
              "size-[15px] shrink-0",
              priorityIconStyles[displayedPriority]
            )}
          />
          <span className="min-w-0 flex-1 truncate text-left">
            {issuePriorityLabels[displayedPriority]}
          </span>
          <IconChevronDown className="size-[15px] shrink-0 opacity-65" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {issuePriorityOptions.map((option) => {
          const OptionIcon = issuePriorityIcons[option.value]
          const isSelected = option.value === displayedPriority

          return (
            <DropdownMenuItem
              key={option.value}
              disabled={mutation.isPending}
              onSelect={() => selectPriority(option.value)}
              className="gap-3"
            >
              <OptionIcon
                className={cn("size-4", priorityIconStyles[option.value])}
              />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {isSelected ? <IconCheck className="size-4" /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
