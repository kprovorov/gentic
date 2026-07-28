"use client"

import Link from "next/link"
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
import { getIssueEditHref } from "@/app/issues/urls"
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
          <h1
            className={cn(
              "text-2xl leading-tight font-semibold tracking-tight break-words",
              !issue.title && "text-muted-foreground italic"
            )}
          >
            {issue.title ?? "Generating title…"}
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
