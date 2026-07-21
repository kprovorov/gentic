"use client"

import { useEffect, useMemo, useState } from "react"
import {
  IconAlertCircle,
  IconCheck,
  IconChevronDown,
  IconDownload,
  IconLoader2,
  IconPaperclip,
  IconRefresh,
} from "@tabler/icons-react"
import { Streamdown } from "streamdown"

import { Bubble, BubbleContent } from "@gentic/ui/bubble"
import { Button } from "@gentic/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@gentic/ui/collapsible"
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
import { groupChatMessages } from "./transcript-items"

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
  const displayItems = useMemo(() => groupChatMessages(messages), [messages])

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <ScrollToEndOnSend sendTick={sendTick} />
      <MessageScroller className="h-[28rem] max-h-[28rem]">
        <MessageScrollerViewport className="pr-1">
          <MessageScrollerContent className="gap-3">
            {displayItems.length === 0 ? (
              <MessageScrollerItem messageId="empty">
                <Marker variant="border">
                  <MarkerContent>
                    No messages yet. Move this issue to Queued to start the
                    agent.
                  </MarkerContent>
                </Marker>
              </MessageScrollerItem>
            ) : (
              displayItems.map((item) => {
                if (item.kind === "tool-group") {
                  return (
                    <MessageScrollerItem
                      key={item.key}
                      messageId={item.messages[0].id}
                    >
                      <ToolCallGroup messages={item.messages} />
                    </MessageScrollerItem>
                  )
                }

                return (
                  <MessageScrollerItem
                    key={item.message.clientKey ?? item.message.id}
                    messageId={item.message.id}
                  >
                    <ChatMessageRow
                      message={item.message}
                      isLatestUserMessage={item.message.id === lastMessage?.id}
                      issueStatus={issueStatus}
                      onRetry={onRetry}
                      retryDisabled={retryDisabled}
                    />
                  </MessageScrollerItem>
                )
              })
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
                : "secondary"
          }
        >
          <BubbleContent className="whitespace-pre-wrap">
            <ChatMarkdown content={content} isStreaming={isStreaming} />
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

function ToolCallGroup({ messages }: { messages: ChatMessage[] }) {
  const [open, setOpen] = useState(false)
  const hasError = messages.some((message) => message.status === "error")
  const hasStreaming = messages.some((message) => message.status === "streaming")
  const summary =
    messages.length === 1
      ? firstLine(messages[0].content ?? "")
      : `${messages.length} tool calls`

  return (
    <Message align="start">
      <MessageContent>
        <Bubble
          align="start"
          variant={hasError ? "destructive" : "muted"}
          className="max-w-full"
        >
          <Collapsible open={open} onOpenChange={setOpen} className="w-full">
            <CollapsibleTrigger asChild>
              <BubbleContent
                asChild
                className="flex w-full cursor-pointer items-center gap-2 rounded-b-none px-3.5 py-2 text-left text-xs text-muted-foreground"
              >
                <button type="button">
                  {hasStreaming ? (
                    <IconLoader2 className="size-3.5 shrink-0 animate-spin" />
                  ) : hasError ? (
                    <IconAlertCircle className="size-3.5 shrink-0" />
                  ) : (
                    <IconCheck className="size-3.5 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {summary || "Tool call"}
                  </span>
                  <IconChevronDown
                    className={cn(
                      "size-3.5 shrink-0 transition-transform",
                      open && "rotate-180"
                    )}
                  />
                </button>
              </BubbleContent>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <BubbleContent className="w-full space-y-2 rounded-t-none border-t px-3.5 py-2">
                {messages.map((message) => (
                  <pre
                    key={message.clientKey ?? message.id}
                    className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-xs text-muted-foreground"
                  >
                    {message.content || "Tool call"}
                  </pre>
                ))}
              </BubbleContent>
            </CollapsibleContent>
          </Collapsible>
        </Bubble>
      </MessageContent>
    </Message>
  )
}

function firstLine(value: string) {
  return value.split(/\r?\n/, 1)[0].trim()
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
