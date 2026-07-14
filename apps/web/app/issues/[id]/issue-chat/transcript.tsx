"use client"

import { useEffect } from "react"
import { IconLoader2 } from "@tabler/icons-react"
import { Streamdown } from "streamdown"

import { Bubble, BubbleContent } from "@gentic/ui/bubble"
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

import type { ChatMessage } from "./types"

export function IssueChatTranscript({
  messages,
  isAgentWorkingWithoutMessage,
  sendTick,
}: {
  messages: ChatMessage[]
  isAgentWorkingWithoutMessage: boolean
  sendTick: number
}) {
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
                  <ChatMessageRow message={message} />
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

function ChatMessageRow({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user"
  const isTool = message.kind === "tool"
  const isMarker = message.role === "system" || message.kind === "thinking"
  const content = message.content ?? ""
  const isStreaming = message.status === "streaming"

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
                <Streamdown
                  className="chat-markdown"
                  controls={{
                    code: { copy: true, download: false },
                    mermaid: false,
                    table: {
                      copy: true,
                      download: false,
                      fullscreen: false,
                    },
                  }}
                  isAnimating={isStreaming}
                  mode={isStreaming ? "streaming" : "static"}
                >
                  {content}
                </Streamdown>
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
            {isTool ? (
              content
            ) : (
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
            )}
            {isStreaming ? (
              <span className="ml-0.5 animate-pulse">▍</span>
            ) : null}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}
