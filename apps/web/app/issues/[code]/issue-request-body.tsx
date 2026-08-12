"use client"

import { AttachmentPreviews, type Attachment } from "./attachments"

// The issue body is the request that kicked off the conversation, not a chat
// turn, so it renders as static text inside the detail header's collapsible
// section rather than as the timeline's first item. It stays unstyled — no
// heading, no tint — so the header reads as one block and the chat bubbles
// below own the visual weight.
export function IssueRequestBody({
  body,
  attachments,
}: {
  body: string | null
  attachments: Attachment[]
}) {
  return (
    <section aria-label="Request" className="min-w-0">
      <p className="text-sm leading-6 whitespace-pre-wrap">
        {body || "No body provided."}
      </p>
      {attachments.length > 0 ? (
        <div className="mt-3.5 border-t pt-3">
          <AttachmentPreviews attachments={attachments} />
        </div>
      ) : null}
    </section>
  )
}
