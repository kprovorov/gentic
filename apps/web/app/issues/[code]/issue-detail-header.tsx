"use client"

import Link from "next/link"
import {
  IconBrandGithub,
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

export function IssueDetailHeader({
  issue,
}: {
  issue: IssueDetailData["issue"]
}) {
  const TypeIcon = issueTypeIcons[issue.type]
  const editHref = getIssueEditHref(issue) ?? "/issues"
  const { isPending, handleDelete } = useIssueDelete(issue.id)

  return (
    <header className="flex flex-col gap-3 border-b pb-6">
      <div className="flex items-center justify-between gap-3">
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-1.5 text-sm text-muted-foreground"
        >
          <Link href="/issues" className="hover:text-foreground">
            Issues
          </Link>
          {issue.code ? (
            <>
              <span aria-hidden>/</span>
              <span className="font-mono text-foreground">{issue.code}</span>
            </>
          ) : null}
        </nav>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Issue actions">
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

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <TypeIcon
          className={cn("size-7 shrink-0", issueTypeStyles[issue.type])}
        />
        <h1
          className={cn(
            "text-3xl leading-tight md:text-4xl",
            !issue.title && "text-muted-foreground italic"
          )}
        >
          {issue.title ?? "Generating title…"}
        </h1>
      </div>

      {issue.projects ? (
        <Link
          href={`https://github.com/${issue.projects.repo}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <IconBrandGithub className="size-4" />
          {issue.projects.repo}
        </Link>
      ) : null}
    </header>
  )
}
