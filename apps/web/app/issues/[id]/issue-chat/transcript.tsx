"use client"

import { useEffect } from "react"
import {
  IconDownload,
  IconLoader2,
  IconPaperclip,
  IconRefresh,
} from "@tabler/icons-react"
import { Streamdown } from "streamdown"

import { Bubble, BubbleContent } from "@gentic/ui/bubble"
import { Button } from "@gentic/ui/button"
import { Marker, MarkerContent, MarkerIcon } from "@gentic/ui/marker"
import { Message, MessageContent } from "@gentic/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@gentic/ui/message-scroller"
import { cn } from "@gentic/ui/utils"
import type { IssueStatus } from "@gentic/validators/issues"

import type { Attachment } from "../attachments"
import type { ChatMessage } from "./types"

export function IssueChatTranscript({
  messages,
  issueStatus,
  isAgentWorkingWithoutMessage,
  sendTick,
  onRetry,
  retryDisabled,
}: {
  messages: ChatMessage[]
  issueStatus: IssueStatus
  isAgentWorkingWithoutMessage: boolean
  sendTick: number
  onRetry: (message: ChatMessage) => void
  retryDisabled: boolean
}) {
  const lastMessage = messages.at(-1)

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <ScrollToEndOnSend sendTick={sendTick} />
      <MessageScroller className="h-[28rem] max-h-[28rem]">
        <MessageScrollerViewport className="pr-1">
          <MessageScrollerContent className="gap-3">
            {messages.length === 0 ? (
              <MessageScrollerItem messageId="empty">
                <Marker variant="border">
                  <MarkerContent>
                    No messages yet. Move this issue to Queued to start the
                    agent.
                  </MarkerContent>
                </Marker>
              </MessageScrollerItem>
            ) : (
              messages.map((message) => (
                <MessageScrollerItem
                  key={message.clientKey ?? message.id}
                  messageId={message.id}
                >
                  <ChatMessageRow
                    message={message}
                    isLatestUserMessage={message.id === lastMessage?.id}
                    issueStatus={issueStatus}
                    onRetry={onRetry}
                    retryDisabled={retryDisabled}
                  />
                </MessageScrollerItem>
              ))
            )}
            {isAgentWorkingWithoutMessage ? (
              <MessageScrollerItem messageId="agent-working">
                <Message>
                  <MessageContent>
                    <Marker role="status">
                      <MarkerIcon>
                        <IconLoader2 className="animate-spin" />
                      </MarkerIcon>
                      <MarkerContent>Agent is working…</MarkerContent>
                    </Marker>
                  </MessageContent>
                </Message>
              </MessageScrollerItem>
            ) : null}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

function ScrollToEndOnSend({ sendTick }: { sendTick: number }) {
  const { scrollToEnd } = useMessageScroller()

  useEffect(() => {
    if (sendTick > 0) {
      scrollToEnd({ behavior: "smooth" })
    }
  }, [sendTick, scrollToEnd])

  return null
}

function ChatMessageRow({
  message,
  isLatestUserMessage = false,
  issueStatus,
  onRetry,
  retryDisabled = false,
}: {
  message: ChatMessage
  isLatestUserMessage?: boolean
  issueStatus?: IssueStatus
  onRetry?: (message: ChatMessage) => void
  retryDisabled?: boolean
}) {
  const isUser = message.role === "user"
  const isTool = message.kind === "tool"
  const isMarker = message.role === "system" || message.kind === "thinking"
  const content = message.content ?? ""
  const isStreaming = message.status === "streaming"
  const deliveryLabel = getDeliveryLabel(message, {
    isLatestUserMessage,
    issueStatus,
  })

  if (isMarker) {
    return (
      <Message>
        <MessageContent>
          <Marker
            role={message.status === "streaming" ? "status" : undefined}
            variant={message.role === "system" ? "border" : "default"}
          >
            {message.status === "streaming" ? (
              <MarkerIcon>
                <IconLoader2 className="animate-spin" />
              </MarkerIcon>
            ) : null}
            <MarkerContent>
              {content ? (
                <ChatMarkdown content={content} isStreaming={isStreaming} />
              ) : (
                "Thinking..."
              )}
              {isStreaming ? (
                <span className="ml-0.5 animate-pulse">▍</span>
              ) : null}
            </MarkerContent>
          </Marker>
        </MessageContent>
      </Message>
    )
  }

  return (
    <Message align={isUser ? "end" : "start"}>
      <MessageContent>
        <Bubble
          align={isUser ? "end" : "start"}
          variant={
            message.status === "error"
              ? "destructive"
              : isUser
                ? "tinted"
                : isTool
                  ? "muted"
                  : "secondary"
          }
        >
          <BubbleContent
            className={cn(
              "whitespace-pre-wrap",
              isTool && "font-mono text-xs text-muted-foreground"
            )}
          >
            {isTool ? content : <ChatMarkdown content={content} isStreaming={isStreaming} />}
            {isStreaming ? (
              <span className="ml-0.5 animate-pulse">▍</span>
            ) : null}
            <MessageAttachments attachments={message.attachments} />
          </BubbleContent>
        </Bubble>
        {deliveryLabel || message.pending === "failed" ? (
          <div className="flex max-w-full flex-wrap items-center justify-end gap-2 px-3.5 text-xs text-muted-foreground">
            {deliveryLabel ? <span>{deliveryLabel}</span> : null}
            {message.pending === "failed" ? (
              <>
                {message.deliveryError ? (
                  <span className="text-destructive">
                    {message.deliveryError}
                  </span>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => onRetry?.(message)}
                  disabled={retryDisabled}
                >
                  <IconRefresh />
                  Retry
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </MessageContent>
    </Message>
  )
}

function ChatMarkdown({
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

function getDeliveryLabel(
  message: ChatMessage,
  {
    isLatestUserMessage,
    issueStatus,
  }: { isLatestUserMessage: boolean; issueStatus?: IssueStatus }
) {
  if (message.role !== "user") {
    return null
  }
  if (message.pending === "sending") {
    return "Sending..."
  }
  if (message.pending === "failed") {
    return "Failed to send"
  }
  if (
    isLatestUserMessage &&
    (issueStatus === "queued" || issueStatus === "in-progress")
  ) {
    return "Delivered. Agent received it and is processing."
  }
  return "Delivered"
}

function MessageAttachments({ attachments }: { attachments?: Attachment[] }) {
  if (!attachments || attachments.length === 0) {
    return null
  }

  return (
    <div className="mt-2 grid gap-1.5">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="flex max-w-full items-center gap-2 rounded-md border bg-background/70 px-2 py-1 text-xs"
        >
          {attachment.thumbnailUrl ? (
            // Supabase signs this URL with Image Transformation options.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={attachment.thumbnailUrl}
              alt=""
              className="size-7 shrink-0 rounded border object-cover"
              loading="lazy"
            />
          ) : (
            <IconPaperclip className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate">{attachment.fileName}</span>
          {attachment.url ? (
            <a
              href={attachment.url}
              target="_blank"
              rel="noreferrer"
              download={attachment.fileName}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <IconDownload className="size-3.5" />
            </a>
          ) : null}
        </div>
      ))}
    </div>
  )
}
