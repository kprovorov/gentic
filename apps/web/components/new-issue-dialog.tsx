"use client"

import { useState } from "react"
import {
  IconArrowsDiagonal,
  IconArrowsDiagonalMinimize2,
  IconLoader2,
  IconX,
} from "@tabler/icons-react"
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
import { cn } from "@gentic/ui/utils"

import { useNewIssueDialog } from "./new-issue-dialog-provider"

export function NewIssueDialog() {
  const { open, setOpen } = useNewIssueDialog()
  const [expanded, setExpanded] = useState(false)
  const { data } = useQuery({
    queryKey: queryKeys.newIssue,
    queryFn: fetchNewIssueData,
    staleTime: queryStaleTimes.formOptions,
    enabled: open,
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) {
          setExpanded(false)
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={cn("max-w-2xl gap-0 p-4", expanded && "h-[85svh]")}
      >
        <DialogTitle className="sr-only">New issue</DialogTitle>
        <DialogDescription className="sr-only">
          Describe the work and choose the repository before saving or running
          it.
        </DialogDescription>

        <div className="absolute top-3 right-3 z-10 flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? <IconArrowsDiagonalMinimize2 /> : <IconArrowsDiagonal />}
            <span className="sr-only">
              {expanded ? "Collapse composer" : "Expand composer"}
            </span>
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
            fillHeight={expanded}
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
