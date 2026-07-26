"use client"

import Link from "next/link"
import type React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  IconCheck,
  IconChevronDown,
  IconDownload,
  IconExternalLink,
  IconGitMerge,
  IconGitPullRequest,
  IconLink,
  IconPaperclip,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react"

import {
  addIssueRelation,
  deleteAttachment,
  deleteIssueRelation,
  updateIssueStatus,
  uploadAttachments,
} from "@/app/issues/actions"
import {
  statusIconStyles,
  statusIcons,
  statusLabels,
  statusOptions,
  statusStyles,
} from "@/app/issues/issues-columns"
import { getIssueHref } from "@/app/issues/urls"
import { queryKeys } from "@/app/query-keys"
import type { IssuePullRequest } from "@/app/queries"
import { Button } from "@gentic/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@gentic/ui/card"
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

import type { Attachment } from "./attachments"

function formatSize(bytes: number | null): string {
  if (!bytes) {
    return ""
  }
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

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
          className={cn(
            "inline-flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-sm font-medium transition-[color,box-shadow,background-color] hover:ring-2 hover:ring-ring/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=open]:ring-2 data-[state=open]:ring-ring/30",
            statusStyles[status]
          )}
        >
          <StatusIcon className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">
            {statusLabels[status]}
          </span>
          <IconChevronDown className="size-3.5 shrink-0 opacity-70" />
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
      <p className="text-sm text-muted-foreground">No pull requests yet.</p>
    )
  }

  return (
    <ul className="grid min-w-0 gap-2">
      {pullRequests.map((pullRequest) => {
        const { repo, number } = parsePullRequestUrl(pullRequest.url)

        return (
          <li key={pullRequest.id} className="min-w-0">
            <Link
              href={pullRequest.url}
              target="_blank"
              rel="noreferrer"
              className="flex min-w-0 items-center gap-3 rounded-2xl bg-muted/40 px-3 py-2 hover:bg-muted/70"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                {isMerged ? (
                  <IconGitMerge className="size-4" />
                ) : (
                  <IconGitPullRequest className="size-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{repo}</p>
                <p className="truncate text-xs text-muted-foreground">
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
}: {
  issueId: string
  relation: IssueRelation
  relatedIssue: IssueRelationIssue
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

  return (
    <li className="flex items-center justify-between gap-3 rounded-2xl bg-muted/40 px-3 py-2">
      <Link
        href={relatedIssueHref}
        className="min-w-0 flex-1 truncate text-sm font-medium hover:text-primary"
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
    <div className="grid gap-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {hasChildren ? (
        <ul className="grid gap-2">{children}</ul>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
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
    <div className="grid gap-4">
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

function IssueDetailAttachmentRow({
  issueId,
  attachment,
}: {
  issueId: string
  attachment: Attachment
}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: deleteAttachment,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.issue(issueId) })
    },
  })

  function handleDelete() {
    if (mutation.isPending) {
      return
    }
    if (!window.confirm(`Delete "${attachment.fileName}"?`)) {
      return
    }

    const formData = new FormData()
    formData.set("id", attachment.id)
    formData.set("issue_id", issueId)
    mutation.mutate(formData)
  }

  return (
    <li className="flex min-w-0 items-center gap-3 rounded-2xl bg-muted/40 px-3 py-2">
      {attachment.thumbnailUrl ? (
        // Supabase signs this URL with Image Transformation options.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={attachment.thumbnailUrl}
          alt=""
          className="size-9 shrink-0 rounded-lg object-cover"
          loading="lazy"
        />
      ) : (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <IconPaperclip className="size-4" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{attachment.fileName}</p>
        <p className="truncate text-xs text-muted-foreground">
          {formatSize(attachment.sizeBytes)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {attachment.url ? (
          <Button asChild variant="ghost" size="icon-xs">
            <a
              href={attachment.url}
              target="_blank"
              rel="noreferrer"
              download={attachment.fileName}
            >
              <IconDownload />
            </a>
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={handleDelete}
          disabled={mutation.isPending}
        >
          <IconTrash />
        </Button>
      </div>
    </li>
  )
}

function IssueDetailAttachments({
  issueId,
  attachments,
}: {
  issueId: string
  attachments: Attachment[]
}) {
  const queryClient = useQueryClient()
  const uploadMutation = useMutation({
    mutationFn: uploadAttachments,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.issue(issueId) })
    },
  })

  function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    uploadMutation.mutate(new FormData(event.currentTarget))
    event.currentTarget.reset()
  }

  return (
    <div className="grid gap-3">
      {attachments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files attached.</p>
      ) : (
        <ul className="grid min-w-0 gap-2">
          {attachments.map((attachment) => (
            <IssueDetailAttachmentRow
              key={attachment.id}
              issueId={issueId}
              attachment={attachment}
            />
          ))}
        </ul>
      )}

      <form
        onSubmit={handleUpload}
        encType="multipart/form-data"
        className="flex flex-wrap items-center gap-2 border-t pt-3"
      >
        <input type="hidden" name="issue_id" value={issueId} />
        <input
          type="file"
          name="files"
          multiple
          className="min-w-0 text-xs text-muted-foreground file:mr-2 file:rounded-full file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-medium"
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={uploadMutation.isPending}
        >
          <IconUpload />
          Upload
        </Button>
      </form>
    </div>
  )
}

export function IssueDetailRail({
  issueId,
  status,
  pullRequests,
  relations,
  relationCandidates,
  attachments,
}: {
  issueId: string
  status: IssueStatus
  pullRequests: IssuePullRequest[]
  relations: IssueRelation[]
  relationCandidates: IssueRelationIssue[]
  attachments: Attachment[]
}) {
  return (
    <aside className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-1">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          <IssueDetailStatus issueId={issueId} status={status} />
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Pull requests</CardTitle>
        </CardHeader>
        <CardContent>
          <IssueDetailPullRequests
            pullRequests={pullRequests}
            issueStatus={status}
          />
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Relations</CardTitle>
        </CardHeader>
        <CardContent>
          <IssueDetailRelations
            issueId={issueId}
            relations={relations}
            candidates={relationCandidates}
          />
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Attachments</CardTitle>
        </CardHeader>
        <CardContent>
          <IssueDetailAttachments
            issueId={issueId}
            attachments={attachments}
          />
        </CardContent>
      </Card>
    </aside>
  )
}
