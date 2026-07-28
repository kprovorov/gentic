"use client"

import { useRouter } from "next/navigation"
import { IconX } from "@tabler/icons-react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { useQuery } from "@tanstack/react-query"

import { fetchNewIssueData } from "@/app/client-queries"
import type { NewIssueData } from "@/app/queries"
import { queryKeys, queryStaleTimes } from "@/app/query-keys"
import { Button } from "@gentic/ui/button"

import { IssueCreateForm } from "../issue-create-form"

export function NewIssueModal({ initialData }: { initialData: NewIssueData }) {
  const router = useRouter()
  const { data } = useQuery({
    queryKey: queryKeys.newIssue,
    queryFn: fetchNewIssueData,
    initialData,
    staleTime: queryStaleTimes.formOptions,
  })
  const { projects, defaultAgentProvider } = data

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          router.back()
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/35 duration-100 supports-backdrop-filter:backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100svh-2rem)] w-[calc(100vw-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-lg border bg-background p-4 shadow-xl duration-200 outline-none sm:p-6 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
        >
          <div className="mb-4 grid gap-1 pr-10">
            <DialogPrimitive.Title className="text-base font-medium text-foreground">
              New issue
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-sm text-muted-foreground">
              Describe the work and choose the project before saving or running
              it.
            </DialogPrimitive.Description>
          </div>
          <IssueCreateForm
            projects={projects}
            defaultAgentProvider={defaultAgentProvider}
            className="w-full"
          />
          <DialogPrimitive.Close asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute top-4 right-4 bg-secondary"
            >
              <IconX />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
