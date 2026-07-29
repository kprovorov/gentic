"use client"

import Link from "next/link"
import type React from "react"
import { useId, useMemo, useState } from "react"
import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query"
import {
  IconCheck,
  IconChevronDown,
  IconCircleDashed,
  IconClock,
  IconExternalLink,
  IconGitMerge,
  IconGitPullRequest,
  IconGitPullRequestClosed,
  IconGitPullRequestDraft,
  IconLink,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { toast } from "sonner"

import {
  addIssueRelation,
  deleteIssueRelation,
  updateIssuePriority,
  updateIssueStatus,
} from "@/app/issues/actions"
import {
  issuePriorityIcons,
  issuePriorityLabels,
  issuePriorityOptions,
  issuePriorityStyles,
} from "@/app/issues/issue-priority-meta"
import {
  statusIconStyles,
  statusIcons,
  statusLabels,
  statusOptions,
} from "@/app/issues/issues-columns"
import { getIssueHref } from "@/app/issues/urls"
import { queryKeys } from "@/app/query-keys"
import type { HomeData, IssueDetailData, IssuePullRequest } from "@/app/queries"
import { Button } from "@gentic/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@gentic/ui/dropdown-menu"
import { Input } from "@gentic/ui/input"
import { NativeSelect, NativeSelectOption } from "@gentic/ui/native-select"
import { cn } from "@gentic/ui/utils"
import type { IssueRelation, IssueRelationIssue } from "@gentic/services/issues"
import type { IssuePriority, IssueStatus } from "@gentic/validators/issues"

function parsePullRequestUrl(url: string) {
  try {
    const [, owner, repo, , number] = new URL(url).pathname.split("/")
    if (owner && repo && number) {
      return { repo: `${owner}/${repo}`, number }
    }
  } catch {
    // Fall back to a generic label for malformed historical data.
  }

  return { repo: "Pull request", number: null }
}

const pullRequestStateMeta = {
  draft: {
    label: "draft",
    icon: IconGitPullRequestDraft,
    className: "bg-muted text-muted-foreground",
  },
  open: {
    label: "open",
    icon: IconGitPullRequest,
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
  merged: {
    label: "merged",
    icon: IconGitMerge,
    className: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  },
  closed: {
    label: "closed",
    icon: IconGitPullRequestClosed,
    className: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  },
  queued: {
    label: "queued",
    icon: IconClock,
    className: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  },
  unknown: {
    label: "status unavailable",
    icon: IconCircleDashed,
    className: "bg-muted text-muted-foreground",
  },
} satisfies Record<
  NonNullable<IssuePullRequest["state"]>,
  {
    label: string
    icon: typeof IconClock
    className: string
  }
>

function IssueDetailStatus({
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
          className="flex h-9 w-full items-center gap-2.5 rounded-2xl border border-border bg-background px-3 text-[13px] text-foreground transition-[color,box-shadow,background-color] hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=open]:ring-2 data-[state=open]:ring-ring/30"
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

function IssueDetailPriority({
  issueId,
  priority,
}: {
  issueId: string
  priority: IssuePriority
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
            "flex h-9 w-full items-center gap-2.5 rounded-2xl border px-3 text-[13px] transition-[color,box-shadow,background-color] hover:ring-2 hover:ring-ring/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=open]:ring-2 data-[state=open]:ring-ring/30",
            issuePriorityStyles[displayedPriority]
          )}
        >
          <PriorityIcon className="size-[15px] shrink-0" />
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
              <OptionIcon className="size-4" />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {isSelected ? <IconCheck className="size-4" /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function IssueDetailPullRequests({
  pullRequests,
  issueStatus,
}: {
  pullRequests: IssuePullRequest[]
  issueStatus: IssueStatus
}) {
  if (pullRequests.length === 0) {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        No pull requests yet.
      </p>
    )
  }

  return (
    <ul className="grid min-w-0 gap-1.5">
      {pullRequests.map((pullRequest) => {
        const { repo, number } = parsePullRequestUrl(pullRequest.url)
        const fallbackState = issueStatus === "merged" ? "merged" : "unknown"
        const stateMeta =
          pullRequestStateMeta[pullRequest.state ?? fallbackState]
        const StateIcon = stateMeta.icon

        return (
          <li key={pullRequest.id} className="min-w-0">
            <Link
              href={pullRequest.url}
              target="_blank"
              rel="noreferrer"
              className="flex min-w-0 items-center gap-2.5 rounded-xl bg-background px-2.5 py-1.5 ring-1 ring-border hover:bg-muted/40"
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full",
                  stateMeta.className
                )}
              >
                <StateIcon className="size-4" />
              </span>
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="truncate text-[12.5px] leading-none font-medium">
                  {repo}
                </p>
                <p className="truncate font-mono text-[11px] leading-none text-muted-foreground">
                  {number ? `#${number} · ` : ""}
                  {stateMeta.label}
                </p>
              </div>
              <IconExternalLink className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function IssueDetailRelationRow({
  issueId,
  relation,
  relatedIssue,
  icon,
  iconClassName,
}: {
  issueId: string
  relation: IssueRelation
  relatedIssue: IssueRelationIssue
  icon: typeof IconClock
  iconClassName: string
}) {
  const queryClient = useQueryClient()
  const relatedIssueHref = getIssueHref(relatedIssue) ?? "/issues"
  const mutation = useMutation({
    mutationFn: deleteIssueRelation,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.issue(issueId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues }),
      ])
    },
  })

  function handleDelete(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    mutation.mutate(new FormData(event.currentTarget))
  }

  const Icon = icon

  return (
    <li className="flex items-center gap-2 rounded-xl bg-background px-2.5 py-2 ring-1 ring-border">
      <Icon className={cn("size-3.5 shrink-0", iconClassName)} />
      <Link
        href={relatedIssueHref}
        className="min-w-0 flex-1 truncate text-[12.5px] font-medium hover:text-primary"
      >
        {relatedIssue.title ?? "Generating title…"}
      </Link>
      <form onSubmit={handleDelete}>
        <input type="hidden" name="id" value={relation.id} />
        <input type="hidden" name="issue_id" value={issueId} />
        <Button
          type="submit"
          variant="ghost"
          size="icon-xs"
          aria-label={`Remove relation to ${relatedIssue.title ?? "issue"}`}
          disabled={mutation.isPending}
        >
          <IconTrash />
        </Button>
      </form>
    </li>
  )
}

function IssueDetailRelationGroup({
  label,
  empty,
  children,
}: {
  label: string
  empty: string
  children: React.ReactNode
}) {
  const hasChildren = Array.isArray(children)
    ? children.length > 0
    : Boolean(children)

  return (
    <div className="grid gap-1.5">
      <p className="text-[10.5px] font-semibold tracking-[.06em] text-muted-foreground/70 uppercase">
        {label}
      </p>
      {hasChildren ? (
        <ul className="grid gap-1.5">{children}</ul>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">{empty}</p>
      )}
    </div>
  )
}

function getRelationIssueCode(issue: IssueRelationIssue) {
  return issue.projects?.key ? `${issue.projects.key}-${issue.number}` : null
}

function getRelationIssueTitle(issue: IssueRelationIssue) {
  return issue.title ?? "Generating title..."
}

function getRelationIssueSearchText(issue: IssueRelationIssue) {
  return [
    issue.title,
    issue.status,
    issue.number,
    issue.projects?.key,
    getRelationIssueCode(issue),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

function getRelationIssueStatusLabel(issue: IssueRelationIssue) {
  return statusLabels[issue.status as IssueStatus] ?? issue.status
}

function IssueRelationDialog({
  issueId,
  issueCode,
  candidates,
  mutation,
}: {
  issueId: string
  issueCode: string | null
  candidates: IssueRelationIssue[]
  mutation: UseMutationResult<void, Error, FormData, unknown>
}) {
  const directionId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [selectedIssueId, setSelectedIssueId] = useState("")
  const [direction, setDirection] = useState<"blocking" | "blocked_by">(
    "blocking"
  )
  const issueLabel = issueCode ?? "this issue"
  const placeholder =
    direction === "blocking"
      ? `Search for issue to mark as blocked by ${issueLabel}...`
      : `Search for issue blocking ${issueLabel}...`
  const actionLabel =
    direction === "blocking" ? "Mark as blocking" : "Mark as blocked by"

  const selectedIssue = candidates.find(
    (candidate) => candidate.id === selectedIssueId
  )
  const filteredCandidates = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    if (!normalizedQuery) {
      return candidates.slice(0, 8)
    }

    return candidates
      .filter((candidate) =>
        getRelationIssueSearchText(candidate).includes(normalizedQuery)
      )
      .slice(0, 8)
  }, [candidates, query])

  function resetDialog() {
    setQuery("")
    setSelectedIssueId("")
    setDirection("blocking")
  }

  function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedIssueId) {
      return
    }

    mutation.mutate(new FormData(event.currentTarget), {
      onSuccess: () => {
        resetDialog()
        setOpen(false)
      },
    })
  }

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) {
          resetDialog()
        }
      }}
    >
      <DialogPrimitive.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Add relation"
        >
          <IconPlus />
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 duration-100 supports-backdrop-filter:backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed top-1/2 left-1/2 z-50 grid w-[calc(100vw-1.5rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[1.4rem] bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/5 duration-100 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 dark:ring-foreground/10">
          <DialogPrimitive.Title className="sr-only">
            Add relation
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search for an existing issue and choose how it relates.
          </DialogPrimitive.Description>

          <form onSubmit={handleAdd} className="grid min-h-[28rem]">
            <input type="hidden" name="issue_id" value={issueId} />
            <input
              type="hidden"
              name="related_issue_id"
              value={selectedIssueId}
            />
            <input type="hidden" name="direction" value={direction} />

            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setSelectedIssueId("")
              }}
              placeholder={placeholder}
              className="h-16 rounded-none border-0 bg-transparent px-9 text-lg placeholder:text-muted-foreground/70 focus-visible:ring-0 md:text-lg"
              autoComplete="off"
              autoFocus
            />

            <div className="grid content-start gap-3 px-3 pb-5">
              <p className="px-6 pt-2 text-sm font-medium text-muted-foreground">
                Recent
              </p>
              <div className="max-h-[18rem] overflow-y-auto">
                {filteredCandidates.length > 0 ? (
                  <ul className="grid gap-1">
                    {filteredCandidates.map((candidate) => {
                      const issueCode = getRelationIssueCode(candidate)
                      const isSelected = candidate.id === selectedIssueId

                      return (
                        <li key={candidate.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedIssueId(candidate.id)
                              setQuery(getRelationIssueTitle(candidate))
                            }}
                            aria-pressed={isSelected}
                            className={cn(
                              "flex h-14 w-full min-w-0 items-center gap-3 rounded-xl px-6 text-left text-base transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                              isSelected && "bg-muted"
                            )}
                          >
                            <span
                              className={cn(
                                "flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/60 text-primary-foreground",
                                isSelected && "border-primary bg-primary"
                              )}
                              aria-hidden="true"
                            >
                              {isSelected ? (
                                <IconCheck className="size-3.5" />
                              ) : null}
                            </span>
                            <span className="min-w-0 flex items-baseline gap-3">
                              {issueCode ? (
                                <span className="shrink-0 font-medium text-muted-foreground">
                                  {issueCode}
                                </span>
                              ) : null}
                              <span className="truncate font-medium">
                                {getRelationIssueTitle(candidate)}
                              </span>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {getRelationIssueStatusLabel(candidate)}
                              </span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="px-6 py-8 text-sm text-muted-foreground">
                    No matching issues.
                  </p>
                )}
              </div>

              {candidates.length === 0 ? (
                <p className="px-6 text-sm text-muted-foreground">
                  Create another issue before adding relations.
                </p>
              ) : null}
            </div>

            <div className="mt-auto flex items-center justify-between gap-3 border-t px-6 py-3">
              <NativeSelect
                id={directionId}
                value={direction}
                onChange={(event) =>
                  setDirection(
                    event.target.value === "blocked_by"
                      ? "blocked_by"
                      : "blocking"
                  )
                }
                aria-label="Relation direction"
                className="w-48"
                size="sm"
              >
                <NativeSelectOption value="blocking">
                  Mark as blocking
                </NativeSelectOption>
                <NativeSelectOption value="blocked_by">
                  Mark as blocked by
                </NativeSelectOption>
              </NativeSelect>

              <div className="flex items-center gap-2">
                <DialogPrimitive.Close asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={mutation.isPending}
                  >
                    Cancel
                  </Button>
                </DialogPrimitive.Close>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!selectedIssue || mutation.isPending}
                >
                  <IconLink />
                  {actionLabel}
                </Button>
              </div>
            </div>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function IssueDetailRelations({
  issueId,
  relations,
}: {
  issueId: string
  relations: IssueRelation[]
}) {
  const blocking = relations.filter(
    (relation) => relation.source_issue_id === issueId
  )
  const blockedBy = relations.filter(
    (relation) => relation.target_issue_id === issueId
  )

  return (
    <div className="grid gap-3">
      <IssueDetailRelationGroup label="Blocks" empty="Not blocking any issue.">
        {blocking.map((relation) => (
          <IssueDetailRelationRow
            key={relation.id}
            issueId={issueId}
            relation={relation}
            relatedIssue={relation.target_issue}
            icon={IconClock}
            iconClassName="text-blue-700 dark:text-blue-300"
          />
        ))}
      </IssueDetailRelationGroup>

      <IssueDetailRelationGroup
        label="Blocked by"
        empty="Not blocked by another issue."
      >
        {blockedBy.map((relation) => (
          <IssueDetailRelationRow
            key={relation.id}
            issueId={issueId}
            relation={relation}
            relatedIssue={relation.source_issue}
            icon={IconCircleDashed}
            iconClassName="text-muted-foreground"
          />
        ))}
      </IssueDetailRelationGroup>
    </div>
  )
}

function RailSection({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="px-[18px] py-4">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold tracking-[.08em] text-muted-foreground uppercase">
          {title}
        </p>
        {action}
      </div>
      {children}
    </div>
  )
}

export function IssueDetailRail({
  issueId,
  issueCode,
  status,
  priority,
  pullRequests,
  relations,
  relationCandidates,
}: {
  issueId: string
  issueCode: string | null
  status: IssueStatus
  priority: IssuePriority
  pullRequests: IssuePullRequest[]
  relations: IssueRelation[]
  relationCandidates: IssueRelationIssue[]
}) {
  const queryClient = useQueryClient()
  const addRelationMutation = useMutation({
    mutationFn: addIssueRelation,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.issue(issueId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues }),
      ])
    },
  })

  return (
    <div className="min-w-0 divide-y divide-border/70">
      <RailSection title="Status">
        <div className="grid gap-2">
          <IssueDetailStatus issueId={issueId} status={status} />
          <IssueDetailPriority issueId={issueId} priority={priority} />
        </div>
      </RailSection>

      <RailSection title="Pull requests">
        <IssueDetailPullRequests
          pullRequests={pullRequests}
          issueStatus={status}
        />
      </RailSection>

      <RailSection
        title="Relations"
        action={
          <IssueRelationDialog
            issueId={issueId}
            issueCode={issueCode}
            candidates={relationCandidates}
            mutation={addRelationMutation}
          />
        }
      >
        <IssueDetailRelations issueId={issueId} relations={relations} />
      </RailSection>
    </div>
  )
}
