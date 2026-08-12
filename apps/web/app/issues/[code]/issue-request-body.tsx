"use client"

import { AttachmentPreviews, type Attachment } from "./attachments"

// The issue body is the request that kicked off the conversation, not a chat
// turn, so it renders as a static card inside the detail header's collapsible
// section rather than as the timeline's first item.
export function IssueRequestBody({
  body,
  attachments,
}: {
  body: string | null
  attachments: Attachment[]
}) {
  return (
    <section aria-label="Request" className="min-w-0">
      <p className="text-[11px] font-semibold tracking-[.08em] text-muted-foreground uppercase">
        Request
      </p>
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
    </section>
  )
}
