"use client"

import Link from "next/link"
import { useLayoutEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { IconDotsVertical, IconPencil, IconTrash } from "@tabler/icons-react"

import type { IssueDetailData, IssuePullRequest } from "@/app/queries"
import { updateIssueTitle } from "@/app/issues/actions"
import {
  AgentProviderBadge,
  IssuePriorityMenu,
  IssueStatusMenu,
  IssueTypeBadge,
  PullRequestPills,
  RepoBadge,
} from "@/app/issues/issues-columns"
import { getIssueEditHref } from "@/app/issues/urls"
import { queryKeys } from "@/app/query-keys"
import { SiteHeaderPortal } from "@/components/site-header-portal"
import { Button } from "@gentic/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@gentic/ui/dropdown-menu"
import { cn } from "@gentic/ui/utils"
import type { LabelSnapshot } from "@gentic/validators/realtime"

import { useIssueDelete } from "./issue-delete-button"
import { IssueLabelChip } from "./issue-label-chip"

function resizeTitleTextarea(element: HTMLTextAreaElement | null) {
  if (!element) {
    return
  }

  element.style.height = "auto"
  element.style.height = `${element.scrollHeight}px`
}

function EditableIssueTitle({ issue }: { issue: IssueDetailData["issue"] }) {
  const queryClient = useQueryClient()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isEditing, setIsEditing] = useState(false)
  const serverTitle = issue.title ?? ""
  const [titleState, setTitleState] = useState(() => ({
    draft: serverTitle,
    saved: serverTitle,
    server: serverTitle,
  }))
  let currentTitleState = titleState
  if (!isEditing && titleState.server !== serverTitle) {
    currentTitleState = {
      draft: serverTitle,
      saved: serverTitle,
      server: serverTitle,
    }
    setTitleState(currentTitleState)
  }
  const savedTitle = currentTitleState.saved

  useLayoutEffect(() => {
    if (!isEditing) {
      return
    }

    const textarea = textareaRef.current
    resizeTitleTextarea(textarea)
    textarea?.focus()
    textarea?.setSelectionRange(textarea.value.length, textarea.value.length)
  }, [isEditing])

  const mutation = useMutation({
    mutationFn: updateIssueTitle,
    onSuccess: async (updatedIssue) => {
      const nextTitle = updatedIssue.title ?? ""
      setTitleState((state) => ({
        ...state,
        draft: nextTitle,
        saved: nextTitle,
      }))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.issue(issue.id) }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.issueEdit(issue.id),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.home }),
        queryClient.invalidateQueries({ queryKey: queryKeys.issues }),
      ])
    },
    onError: () => {
      setTitleState((state) => ({ ...state, draft: state.saved }))
    },
  })

  function finishEditing() {
    setIsEditing(false)

    const nextTitle = currentTitleState.draft.trim()
    if (!nextTitle) {
      setTitleState((state) => ({ ...state, draft: state.saved }))
      return
    }

    if (nextTitle === savedTitle || mutation.isPending) {
      setTitleState((state) => ({ ...state, draft: nextTitle }))
      return
    }

    setTitleState((state) => ({ ...state, draft: nextTitle }))
    const formData = new FormData()
    formData.set("id", issue.id)
    formData.set("title", nextTitle)
    mutation.mutate(formData)
  }

  const displayTitle = isEditing
    ? currentTitleState.draft || "Generating title..."
    : savedTitle || "Generating title..."

  if (isEditing) {
    return (
      <textarea
        ref={textareaRef}
        value={currentTitleState.draft}
        aria-label="Issue title"
        rows={1}
        maxLength={160}
        disabled={mutation.isPending}
        onBlur={finishEditing}
        onChange={(event) => {
          setTitleState((state) => ({
            ...state,
            draft: event.target.value,
          }))
          resizeTitleTextarea(event.currentTarget)
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault()
            event.currentTarget.blur()
            return
          }

          if (event.key === "Escape") {
            event.preventDefault()
            setTitleState((state) => ({ ...state, draft: state.saved }))
            setIsEditing(false)
          }
        }}
        className={cn(
          "block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-lg leading-tight font-semibold tracking-tight text-pretty break-words shadow-none outline-none ring-0 focus:border-0 focus:shadow-none focus:ring-0 focus:outline-none focus-visible:border-0 focus-visible:shadow-none focus-visible:ring-0 focus-visible:outline-none disabled:opacity-70",
          !currentTitleState.draft && "text-muted-foreground italic"
        )}
      />
    )
  }

  return (
    <button
      type="button"
      disabled={mutation.isPending}
      onClick={() => {
        setTitleState((state) => ({ ...state, draft: state.saved }))
        setIsEditing(true)
      }}
      className={cn(
        "block w-full cursor-text border-0 bg-transparent p-0 text-left text-lg leading-tight font-semibold tracking-tight break-words shadow-none outline-none ring-0 focus:border-0 focus:shadow-none focus:ring-0 focus:outline-none focus-visible:border-0 focus-visible:shadow-none focus-visible:ring-0 focus-visible:outline-none disabled:cursor-default disabled:opacity-70",
        !displayTitle && "text-muted-foreground italic"
      )}
    >
      {displayTitle}
    </button>
  )
}

export function IssueDetailHeader({
  issue,
  pullRequests,
  labels,
}: {
  issue: IssueDetailData["issue"]
  pullRequests: IssuePullRequest[]
  labels: LabelSnapshot[]
}) {
  const editHref = getIssueEditHref(issue) ?? "/issues"
  const { isPending, handleDelete } = useIssueDelete(issue.id)

  return (
    <header className="flex min-w-0 flex-none flex-col gap-3 px-6 py-4">
      <SiteHeaderPortal>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Issue actions"
              className="shrink-0"
            >
              <IconDotsVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={editHref}>
                <IconPencil />
                Edit
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={isPending}
              onSelect={(event) => {
                event.preventDefault()
                handleDelete()
              }}
            >
              <IconTrash />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SiteHeaderPortal>

      <div className="flex min-w-0 items-start gap-3">
        <IssueStatusMenu issue={issue} />

        <div className="min-w-0 flex-1">
          {/* Headings are `text-balance` globally, which wraps the title into
              short balanced lines; the detail title should use the full row. */}
          <h1 className="text-pretty">
            <EditableIssueTitle issue={issue} />
          </h1>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 xl:hidden">
        <IssueTypeBadge type={issue.type} />
        <AgentProviderBadge provider={issue.agent_provider} />
        {issue.projects ? <RepoBadge repo={issue.projects.repo} /> : null}
        <PullRequestPills pullRequests={pullRequests} />
        <IssuePriorityMenu issue={issue} showLabel />
        {labels.map((label) => (
          <IssueLabelChip key={label.id} label={label} className="text-xs" />
        ))}
      </div>
    </header>
  )
}
