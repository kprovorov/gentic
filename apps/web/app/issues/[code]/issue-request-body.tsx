"use client"

import { useState } from "react"
import { IconChevronDown } from "@tabler/icons-react"

import { cn } from "@gentic/ui/utils"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@gentic/ui/collapsible"

import { AttachmentPreviews, type Attachment } from "./attachments"
import { firstLine } from "./issue-chat/transcript-items"

// The issue body is the request that kicked off the conversation, not a
// chat turn, so it renders as a static section above the message timeline
// rather than as the timeline's first item.
export function IssueRequestBody({
  body,
  attachments,
}: {
  body: string | null
  attachments: Attachment[]
}) {
  const [open, setOpen] = useState(true)
  const hint = open
    ? attachments.length > 0
      ? `${attachments.length} attachment${attachments.length === 1 ? "" : "s"}`
      : null
    : firstLine(body ?? "")

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="mx-auto w-full min-w-0 max-w-[840px] px-6 pt-5 pb-5"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full min-w-0 items-center gap-2"
        >
          <span className="text-[11px] font-semibold tracking-[.08em] text-muted-foreground uppercase">
            Request
          </span>
          {hint ? (
            <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">
              {hint}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <IconChevronDown
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180"
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 min-w-0 rounded-[20px] bg-muted/40 p-4">
          <p className="text-sm leading-6 whitespace-pre-wrap">
            {body || "No body provided."}
          </p>
          {attachments.length > 0 ? (
            <div className="mt-3.5 border-t pt-3">
              <AttachmentPreviews attachments={attachments} />
            </div>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
