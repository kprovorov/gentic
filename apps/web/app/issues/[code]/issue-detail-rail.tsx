"use client"

import Link from "next/link"
import type React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  IconCheck,
  IconChevronDown,
  IconCircleDashed,
  IconClock,
  IconExternalLink,
  IconGitMerge,
  IconGitPullRequest,
  IconLink,
  IconTrash,
} from "@tabler/icons-react"

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

function IssueDetailRelations({
  issueId,
  relations,
  candidates,
}: {
  issueId: string
  relations: IssueRelation[]
  candidates: IssueRelationIssue[]
}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: addIssueRelation,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.issue(issueId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues }),
      ])
    },
  })

  function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    mutation.mutate(new FormData(event.currentTarget))
    event.currentTarget.reset()
  }

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

      <form onSubmit={handleAdd} className="grid gap-2 border-t pt-4">
        <input type="hidden" name="issue_id" value={issueId} />
        <NativeSelect
          name="related_issue_id"
          disabled={candidates.length === 0}
          required
          aria-label="Related issue"
          className="w-full min-w-0"
        >
          <NativeSelectOption value="" disabled>
            Select issue
          </NativeSelectOption>
          {candidates.map((candidate) => (
            <NativeSelectOption key={candidate.id} value={candidate.id}>
              {candidate.title ?? "Generating title…"}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <div className="flex gap-2">
          <NativeSelect
            name="direction"
            disabled={candidates.length === 0}
            defaultValue="blocking"
            aria-label="Relation direction"
            className="flex-1"
          >
            <NativeSelectOption value="blocking">Blocks</NativeSelectOption>
            <NativeSelectOption value="blocked_by">
              Blocked by
            </NativeSelectOption>
          </NativeSelect>
          <Button
            type="submit"
            size="sm"
            disabled={candidates.length === 0 || mutation.isPending}
          >
            <IconLink />
            Add
          </Button>
        </div>
        {candidates.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Create another issue before adding relations.
          </p>
        ) : null}
      </form>
    </div>
  )
}

function RailSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="px-[18px] py-4">
      <p className="mb-2.5 text-[11px] font-semibold tracking-[.08em] text-muted-foreground uppercase">
        {title}
      </p>
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

      <RailSection title="Relations">
        <IssueDetailRelations
          issueId={issueId}
          relations={relations}
          candidates={relationCandidates}
        />
      </RailSection>
    </div>
  )
}
