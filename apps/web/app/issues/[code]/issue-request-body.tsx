"use client"

import { AttachmentPreviews, type Attachment } from "./attachments"
import { ChatMarkdown } from "./issue-chat/chat-markdown"

// The issue body is the request that kicked off the conversation, not a chat
// turn, so it renders inside the detail header's collapsible section rather
// than as the timeline's first item. It stays unstyled — no heading, no tint —
// so the header reads as one block and the chat bubbles below own the visual
// weight. Bodies are markdown — agents template them with headings and lists,
// and humans paste markdown into the composer — so they go through the same
// renderer as chat messages.
export function IssueRequestBody({
  body,
  attachments,
}: {
  body: string | null
  attachments: Attachment[]
}) {
  return (
    <section aria-label="Request" className="min-w-0">
      {body ? (
        <ChatMarkdown content={body} isStreaming={false} />
      ) : (
        <p className="text-sm leading-6">No body provided.</p>
      )}
      {attachments.length > 0 ? (
        <div className="mt-3.5 border-t pt-3">
          <AttachmentPreviews attachments={attachments} />
        </div>
      ) : null}
    </section>
  )
}
