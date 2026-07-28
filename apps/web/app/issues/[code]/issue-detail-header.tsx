"use client"

import Link from "next/link"
import { useLayoutEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  IconBug,
  IconBulb,
  IconDotsVertical,
  IconFileDescription,
  IconMessage2,
  IconPencil,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react"

import type { IssueDetailData } from "@/app/queries"
import { updateIssueTitle } from "@/app/issues/actions"
import { getIssueEditHref } from "@/app/issues/urls"
import { queryKeys } from "@/app/query-keys"
import { Button } from "@gentic/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@gentic/ui/dropdown-menu"
import { cn } from "@gentic/ui/utils"
import { BrandIcon } from "@/components/agent-provider-icon"

import { useIssueDelete } from "./issue-delete-button"

const issueTypeIcons = {
  issue: IconFileDescription,
  feature: IconSparkles,
  bug: IconBug,
  feedback: IconMessage2,
  idea: IconBulb,
}

const issueTypeStyles: Record<IssueDetailData["issue"]["type"], string> = {
  issue: "text-muted-foreground",
  feature: "text-violet-700 dark:text-violet-300",
  bug: "text-red-700 dark:text-red-300",
  feedback: "text-sky-700 dark:text-sky-300",
  idea: "text-amber-700 dark:text-amber-300",
}

const issueTypeBadgeStyles: Record<IssueDetailData["issue"]["type"], string> =
  {
    issue: "bg-muted-foreground/14",
    feature: "bg-violet-500/14",
    bug: "bg-red-500/14",
    feedback: "bg-sky-500/14",
    idea: "bg-amber-500/14",
  }

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
  const [title, setTitle] = useState(issue.title ?? "")
  const [lastSavedTitle, setLastSavedTitle] = useState(issue.title ?? "")

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
      setLastSavedTitle(updatedIssue.title ?? "")
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
      setTitle(lastSavedTitle)
    },
  })

  function finishEditing() {
    setIsEditing(false)

    const nextTitle = title.trim()
    if (!nextTitle) {
      setTitle(lastSavedTitle)
      return
    }

    if (nextTitle === lastSavedTitle || mutation.isPending) {
      setTitle(nextTitle)
      return
    }

    setTitle(nextTitle)
    const formData = new FormData()
    formData.set("id", issue.id)
    formData.set("title", nextTitle)
    mutation.mutate(formData)
  }

  const displayTitle = title || "Generating title..."

  if (isEditing) {
    return (
      <textarea
        ref={textareaRef}
        value={title}
        aria-label="Issue title"
        rows={1}
        maxLength={160}
        disabled={mutation.isPending}
        onBlur={finishEditing}
        onChange={(event) => {
          setTitle(event.target.value)
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
            setTitle(lastSavedTitle)
            setIsEditing(false)
          }
        }}
        className={cn(
          "block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-2xl leading-tight font-semibold tracking-tight break-words shadow-none outline-none ring-0 focus:border-0 focus:shadow-none focus:ring-0 focus:outline-none focus-visible:border-0 focus-visible:shadow-none focus-visible:ring-0 focus-visible:outline-none disabled:opacity-70",
          !title && "text-muted-foreground italic"
        )}
      />
    )
  }

  return (
    <button
      type="button"
      disabled={mutation.isPending}
      onClick={() => setIsEditing(true)}
      className={cn(
        "block w-full cursor-text border-0 bg-transparent p-0 text-left text-2xl leading-tight font-semibold tracking-tight break-words shadow-none outline-none ring-0 focus:border-0 focus:shadow-none focus:ring-0 focus:outline-none focus-visible:border-0 focus-visible:shadow-none focus-visible:ring-0 focus-visible:outline-none disabled:cursor-default disabled:opacity-70",
        !title && "text-muted-foreground italic"
      )}
    >
      {displayTitle}
    </button>
  )
}

export function IssueDetailHeader({
  issue,
}: {
  issue: IssueDetailData["issue"]
}) {
  const TypeIcon = issueTypeIcons[issue.type]
  const editHref = getIssueEditHref(issue) ?? "/issues"
  const { isPending, handleDelete } = useIssueDelete(issue.id)

  return (
    <header className="flex min-w-0 flex-none flex-col gap-2 px-6 py-5">
      <div className="flex min-w-0 items-start gap-3.5">
        <span
          className={cn(
            "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl",
            issueTypeBadgeStyles[issue.type]
          )}
        >
          <TypeIcon className={cn("size-4.5", issueTypeStyles[issue.type])} />
        </span>

        <div className="min-w-0 flex-1">
          <h1>
            <EditableIssueTitle key={issue.title ?? ""} issue={issue} />
          </h1>

          {issue.projects ? (
            <Link
              href={`https://github.com/${issue.projects.repo}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex max-w-full min-w-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <BrandIcon name="github" className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate font-mono">
                {issue.projects.repo}
              </span>
            </Link>
          ) : null}
        </div>

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
      </div>
    </header>
  )
}
