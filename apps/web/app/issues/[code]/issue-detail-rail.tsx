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
  IconCircleDashed,
  IconExternalLink,
  IconGitPullRequest,
  IconLink,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { toast } from "sonner"

import {
  addIssueLabels,
  addIssueRelation,
  createManualIssuePullRequest,
  deleteIssueRelation,
  removeIssueLabels,
} from "@/app/issues/actions"
import { IssueLabelsField } from "@/app/issues/issue-labels-field"
import {
  statusIconStyles,
  statusIcons,
  statusLabels,
} from "@/app/issues/issues-columns"
import { pullRequestStateMeta } from "@/app/issues/pull-request-state-meta"
import { getIssueHref } from "@/app/issues/urls"
import { queryKeys } from "@/app/query-keys"
import type { IssuePullRequest } from "@/app/queries"
import { Button } from "@gentic/ui/button"
import { Input } from "@gentic/ui/input"
import { NativeSelect, NativeSelectOption } from "@gentic/ui/native-select"
import { cn } from "@gentic/ui/utils"
import type {
  IssueRelation,
  IssueRelationIssue,
} from "@gentic/services/issues"
import type { IssuePriority, IssueStatus } from "@gentic/validators/issues"
import type { LabelSnapshot } from "@gentic/validators/realtime"

import { Attachments, type Attachment } from "./attachments"
import { IssueLabelChip } from "./issue-label-chip"
import { canShowManualCreatePrAction } from "./manual-create-pr-visibility"
import {
  IssueDetailPriority,
  IssueDetailStatus,
} from "./issue-detail-status-priority"

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

function IssueDetailPullRequests({
  issueId,
  pullRequests,
  issueStatus,
  hasUnpublishedAgentChanges,
  automaticPrPublishingInProgress,
}: {
  issueId: string
  pullRequests: IssuePullRequest[]
  issueStatus: IssueStatus
  hasUnpublishedAgentChanges: boolean
  automaticPrPublishingInProgress: boolean
}) {
  const hasAttachedPullRequest = pullRequests.length > 0
  const showCreatePr = canShowManualCreatePrAction({
    status: issueStatus,
    hasUnpublishedAgentChanges,
    hasAttachedPullRequest,
    automaticPublishingInProgress: automaticPrPublishingInProgress,
  })

  if (pullRequests.length === 0) {
    return (
      <div className="grid gap-2">
        <p className="text-[12.5px] text-muted-foreground">
          No pull requests yet.
        </p>
        {showCreatePr ? (
          <ManualCreatePrButton issueId={issueId} />
        ) : null}
      </div>
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
                <StateIcon className={cn("size-4", stateMeta.iconClassName)} />
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

function ManualCreatePrButton({
  issueId,
}: {
  issueId: string
}) {
  const queryClient = useQueryClient()
  const [optimisticRequested, setOptimisticRequested] = useState(false)
  const mutation = useMutation({
    mutationFn: createManualIssuePullRequest,
    onMutate: () => {
      setOptimisticRequested(true)
    },
    onSuccess: async (result) => {
      if (!result.ok) {
        setOptimisticRequested(false)
        toast.error(result.error)
        return
      }
      toast.success("Create PR request sent")
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.issue(issueId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues }),
      ])
    },
    onError: (error) => {
      setOptimisticRequested(false)
      toast.error(getCreatePrErrorMessage(error))
    },
  })
  const isPending = mutation.isPending

  function submit() {
    if (isPending || optimisticRequested) {
      return
    }
    const formData = new FormData()
    formData.set("issue_id", issueId)
    mutation.mutate(formData)
  }

  if (optimisticRequested) {
    return (
      <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-2 text-[12.5px] text-emerald-700 dark:text-emerald-300">
        {isPending ? "Requesting pull request..." : "Create PR request sent."}
      </p>
    )
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="w-full justify-start gap-2"
      disabled={isPending}
      onClick={submit}
    >
      <IconGitPullRequest className="size-4" />
      Create PR
    </Button>
  )
}

function getCreatePrErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return "Failed to request pull request creation"
}

function IssueDetailRelationRow({
  issueId,
  relation,
  relatedIssue,
}: {
  issueId: string
  relation: IssueRelation
  relatedIssue: IssueRelationIssue
}) {
  const queryClient = useQueryClient()
  const relatedIssueHref = getIssueHref(relatedIssue) ?? "/issues"
  const relatedIssueStatus = relatedIssue.status as IssueStatus
  const StatusIcon = statusIcons[relatedIssueStatus] ?? IconCircleDashed
  const statusIconClassName =
    statusIconStyles[relatedIssueStatus] ?? "text-muted-foreground"
  const statusLabel = statusLabels[relatedIssueStatus] ?? relatedIssue.status
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

  return (
    <li className="flex items-center gap-2 rounded-xl bg-background px-2.5 py-2 ring-1 ring-border">
      <StatusIcon
        aria-label={`${statusLabel} status`}
        className={cn("size-3.5 shrink-0", statusIconClassName)}
      />
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
          />
        ))}
      </IssueDetailRelationGroup>
    </div>
  )
}

function IssueDetailLabels({
  issueId,
  labels,
}: {
  issueId: string
  labels: LabelSnapshot[]
}) {
  const queryClient = useQueryClient()
  const [optimisticIds, setOptimisticIds] = useState<string[] | null>(null)
  const currentIds = optimisticIds ?? labels.map((label) => label.id)
  const displayedLabels = optimisticIds
    ? labels.filter((label) => optimisticIds.includes(label.id))
    : labels

  async function onSettled() {
    await queryClient.invalidateQueries({ queryKey: queryKeys.issue(issueId) })
    setOptimisticIds(null)
  }

  const addMutation = useMutation({
    mutationFn: addIssueLabels,
    onError: () => {
      toast.error("Failed to add label")
    },
    onSettled,
  })
  const removeMutation = useMutation({
    mutationFn: removeIssueLabels,
    onError: () => {
      toast.error("Failed to remove label")
    },
    onSettled,
  })

  function handleSelectedIdsChange(nextIds: string[]) {
    const addedIds = nextIds.filter((id) => !currentIds.includes(id))
    const removedIds = currentIds.filter((id) => !nextIds.includes(id))
    setOptimisticIds(nextIds)

    if (addedIds.length > 0) {
      const formData = new FormData()
      formData.set("issue_id", issueId)
      for (const id of addedIds) formData.append("label_id", id)
      addMutation.mutate(formData)
    }
    if (removedIds.length > 0) {
      const formData = new FormData()
      formData.set("issue_id", issueId)
      for (const id of removedIds) formData.append("label_id", id)
      removeMutation.mutate(formData)
    }
  }

  return (
    <div className="grid gap-2">
      {displayedLabels.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {displayedLabels.map((label) => (
            <IssueLabelChip key={label.id} label={label} />
          ))}
        </div>
      ) : (
        <p className="text-[12.5px] text-muted-foreground">No labels yet.</p>
      )}
      <IssueLabelsField
        selectedIds={currentIds}
        onSelectedIdsChange={handleSelectedIdsChange}
      />
    </div>
  )
}

function RailSection({
  title,
  action,
  className,
  children,
}: {
  title: string
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("px-[18px] py-4", className)}>
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
  hasUnpublishedAgentChanges,
  automaticPrPublishingInProgress,
  pullRequests,
  relations,
  relationCandidates,
  labels,
  attachments,
}: {
  issueId: string
  issueCode: string | null
  status: IssueStatus
  priority: IssuePriority
  hasUnpublishedAgentChanges: boolean
  automaticPrPublishingInProgress: boolean
  pullRequests: IssuePullRequest[]
  relations: IssueRelation[]
  relationCandidates: IssueRelationIssue[]
  labels: LabelSnapshot[]
  attachments: Attachment[]
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
      <RailSection title="Status" className="hidden xl:block">
        <div className="grid gap-2">
          <IssueDetailStatus issueId={issueId} status={status} />
          <IssueDetailPriority issueId={issueId} priority={priority} />
        </div>
      </RailSection>

      <RailSection title="Labels">
        <IssueDetailLabels issueId={issueId} labels={labels} />
      </RailSection>

      <RailSection title="Pull requests">
        <IssueDetailPullRequests
          issueId={issueId}
          pullRequests={pullRequests}
          issueStatus={status}
          hasUnpublishedAgentChanges={hasUnpublishedAgentChanges}
          automaticPrPublishingInProgress={automaticPrPublishingInProgress}
        />
      </RailSection>

      {/* Files attached to the issue itself: they are not part of any chat
          turn, so they stay here across agent and conversation resets. */}
      <RailSection title="Files">
        <Attachments issueId={issueId} attachments={attachments} />
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
