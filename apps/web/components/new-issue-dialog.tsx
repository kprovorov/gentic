"use client"

import { IconLoader2 } from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"

import { fetchNewIssueData } from "@/app/client-queries"
import { IssueCreateForm } from "@/app/issues/issue-create-form"
import { queryKeys, queryStaleTimes } from "@/app/query-keys"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
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
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>New issue</DialogTitle>
          <DialogDescription>
            Describe the work and choose the project before saving or running
            it.
          </DialogDescription>
        </DialogHeader>
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
