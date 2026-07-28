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
  IconLink,
  IconPlus,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import {
  addIssueRelation,
  deleteIssueRelation,
  updateIssueStatus,
} from "@/app/issues/actions"
import {
  statusIconStyles,
  statusIcons,
  statusLabels,
  statusOptions,
} from "@/app/issues/issues-columns"
import { getIssueHref } from "@/app/issues/urls"
import { queryKeys } from "@/app/query-keys"
import type { IssuePullRequest } from "@/app/queries"
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
import type { IssueStatus } from "@gentic/validators/issues"

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

function IssueDetailPullRequests({
  pullRequests,
  issueStatus,
}: {
  pullRequests: IssuePullRequest[]
  issueStatus: IssueStatus
}) {
  // Individual PR state isn't tracked -- only the URL is stored -- so this
  // treats every PR as merged once the issue itself reaches "merged".
  const isMerged = issueStatus === "merged"

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

        return (
          <li key={pullRequest.id} className="min-w-0">
            <Link
              href={pullRequest.url}
              target="_blank"
              rel="noreferrer"
              className="flex min-w-0 items-center gap-2.5 rounded-xl bg-background px-2.5 py-2 ring-1 ring-border hover:bg-muted/40"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                {isMerged ? (
                  <IconGitMerge className="size-4" />
                ) : (
                  <IconGitPullRequest className="size-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-medium">{repo}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {number ? `#${number} · ` : ""}
                  {isMerged ? "merged" : "open"}
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

function IssueRelationDialog({
  issueId,
  candidates,
  mutation,
}: {
  issueId: string
  candidates: IssueRelationIssue[]
  mutation: UseMutationResult<void, Error, FormData, unknown>
}) {
  const queryId = useId()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [selectedIssueId, setSelectedIssueId] = useState("")

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
        <DialogPrimitive.Content className="fixed top-1/2 left-1/2 z-50 grid w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-5 rounded-3xl bg-popover p-5 text-popover-foreground shadow-xl ring-1 ring-foreground/5 duration-100 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 dark:ring-foreground/10">
          <div className="grid gap-1">
            <DialogPrimitive.Title className="text-base font-medium">
              Add relation
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-sm text-muted-foreground">
              Search for an existing issue and choose how it relates.
            </DialogPrimitive.Description>
          </div>

          <form onSubmit={handleAdd} className="grid gap-4">
            <input type="hidden" name="issue_id" value={issueId} />
            <input
              type="hidden"
              name="related_issue_id"
              value={selectedIssueId}
            />

            <div className="grid gap-2">
              <label
                htmlFor={queryId}
                className="text-xs font-medium text-muted-foreground"
              >
                Issue
              </label>
              <div className="relative">
                <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id={queryId}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setSelectedIssueId("")
                  }}
                  placeholder="Search issues"
                  className="pr-3 pl-9"
                  autoComplete="off"
                />
              </div>
              <div className="max-h-56 overflow-y-auto rounded-2xl border bg-background p-1">
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
                              "flex w-full min-w-0 items-center gap-2 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                              isSelected && "bg-muted"
                            )}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-medium">
                                {getRelationIssueTitle(candidate)}
                              </span>
                              <span className="block truncate font-mono text-[11px] text-muted-foreground">
                                {issueCode ? `${issueCode} · ` : ""}
                                {candidate.status}
                              </span>
                            </span>
                            {isSelected ? (
                              <IconCheck className="size-4 shrink-0 text-primary" />
                            ) : null}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                    No matching issues.
                  </p>
                )}
              </div>
            </div>

            <div className="grid gap-2">
              <label
                htmlFor={`${queryId}-direction`}
                className="text-xs font-medium text-muted-foreground"
              >
                Relation type
              </label>
              <NativeSelect
                id={`${queryId}-direction`}
                name="direction"
                defaultValue="blocking"
                aria-label="Relation direction"
                className="w-full"
              >
                <NativeSelectOption value="blocking">
                  Blocking
                </NativeSelectOption>
                <NativeSelectOption value="blocked_by">
                  Blocked by
                </NativeSelectOption>
              </NativeSelect>
            </div>

            {candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Create another issue before adding relations.
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <DialogPrimitive.Close asChild>
                <Button
                  type="button"
                  variant="outline"
                  disabled={mutation.isPending}
                >
                  Cancel
                </Button>
              </DialogPrimitive.Close>
              <Button
                type="submit"
                disabled={!selectedIssue || mutation.isPending}
              >
                <IconLink />
                Add
              </Button>
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
  status,
  pullRequests,
  relations,
  relationCandidates,
}: {
  issueId: string
  status: IssueStatus
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
        <IssueDetailStatus issueId={issueId} status={status} />
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
