"use client"

import Link from "next/link"
import { IconArrowsDiagonal, IconLoader2, IconX } from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"

import { fetchNewIssueData } from "@/app/client-queries"
import { IssueCreateForm } from "@/app/issues/issue-create-form"
import { queryKeys, queryStaleTimes } from "@/app/query-keys"
import { Button } from "@gentic/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@gentic/ui/dialog"

import { useNewIssueDialog } from "./new-issue-dialog-provider"

export function NewIssueDialog() {
  const { open, setOpen } = useNewIssueDialog()
  const { data } = useQuery({
    queryKey: queryKeys.newIssue,
    queryFn: fetchNewIssueData,
    staleTime: queryStaleTimes.formOptions,
    enabled: open,
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false} className="max-w-2xl gap-0 p-4">
        <DialogTitle className="sr-only">New issue</DialogTitle>
        <DialogDescription className="sr-only">
          Describe the work and choose the repository before saving or running
          it.
        </DialogDescription>

        <div className="absolute top-3 right-3 z-10 flex items-center gap-0.5">
          <Button
            asChild
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(false)}
          >
            <Link href="/issues/new" aria-label="Open in full page">
              <IconArrowsDiagonal />
            </Link>
          </Button>
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
            >
              <IconX />
              <span className="sr-only">Close</span>
            </Button>
          </DialogClose>
        </div>

        {data ? (
          <IssueCreateForm
            projects={data.projects}
            defaultAgentProvider={data.defaultAgentProvider}
            className="w-full"
          />
        ) : (
          <div className="flex min-h-40 items-center justify-center">
            <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
