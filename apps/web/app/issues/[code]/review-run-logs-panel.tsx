"use client"

import { useState } from "react"
import { IconFileText } from "@tabler/icons-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { Button } from "@gentic/ui/button"
import { cn } from "@gentic/ui/utils"

import { useReviewRunLogs } from "./use-review-run-logs"

// The Review Run log sink, rendered here and linked from the timeline —
// deliberately never appended to Issue chat (GEN-415/GEN-419): a reviewer's
// execution log is accessible, not part of the conversation transcript.
export function ReviewRunLogsTrigger({
  issueId,
  reviewRunId,
  isLive,
  label = "View logs",
}: {
  issueId: string
  reviewRunId: string
  isLive: boolean
  label?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
        >
          <IconFileText className="size-3.5" />
          {label}
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 supports-backdrop-filter:backdrop-blur-sm" />
        <DialogPrimitive.Content className="fixed top-1/2 left-1/2 z-50 grid max-h-[80vh] w-[calc(100vw-1.5rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_1fr] overflow-hidden rounded-2xl bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/5 duration-100 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 dark:ring-foreground/10">
          <div className="flex items-center justify-between gap-2 border-b px-5 py-3">
            <DialogPrimitive.Title className="text-sm font-semibold">
              Review run log
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button type="button" variant="ghost" size="sm">
                Close
              </Button>
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">
            The reviewer agent&apos;s execution log for this run.
          </DialogPrimitive.Description>
          {open ? (
            <ReviewRunLogsBody
              issueId={issueId}
              reviewRunId={reviewRunId}
              isLive={isLive}
            />
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function ReviewRunLogsBody({
  issueId,
  reviewRunId,
  isLive,
}: {
  issueId: string
  reviewRunId: string
  isLive: boolean
}) {
  const { logs, status } = useReviewRunLogs({
    issueId,
    reviewRunId,
    isLive,
    enabled: true,
  })

  return (
    <div className="min-h-0 overflow-y-auto px-5 py-4">
      {status === "loading" ? (
        <p className="text-sm text-muted-foreground">Loading log…</p>
      ) : status === "error" ? (
        <p className="text-sm text-destructive">Couldn&apos;t load the log.</p>
      ) : logs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No log entries yet.</p>
      ) : (
        <ol className="grid gap-3">
          {logs.map((entry) => (
            <li key={entry.id} className="grid gap-1">
              <span
                className={cn(
                  "text-[10.5px] font-semibold tracking-[.06em] uppercase",
                  entry.role === "system"
                    ? "text-amber-600 dark:text-amber-300"
                    : "text-muted-foreground"
                )}
              >
                {entry.role}
              </span>
              <p className="text-sm whitespace-pre-wrap">{entry.content}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
