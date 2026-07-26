"use client"

import { Streamdown } from "streamdown"

export function ChatMarkdown({
  content,
  isStreaming,
}: {
  content: string
  isStreaming: boolean
}) {
  return (
    <Streamdown
      className="chat-markdown"
      controls={{
        code: { copy: true, download: false },
        mermaid: false,
        table: { copy: true, download: false, fullscreen: false },
      }}
      isAnimating={isStreaming}
      mode={isStreaming ? "streaming" : "static"}
    >
      {content}
    </Streamdown>
  )
}
