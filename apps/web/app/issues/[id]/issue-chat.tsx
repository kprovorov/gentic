"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  IconExternalLink,
  IconGitPullRequest,
  IconLoader2,
  IconSend,
} from "@tabler/icons-react"
import { Streamdown } from "streamdown"

import { useSupabaseClient } from "@gentic/supabase/client"
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
import {
  issueRealtimeTopic,
  messageEventSchema,
  REALTIME_MESSAGE_EVENT,
  REALTIME_RUN_STATE_EVENT,
  REALTIME_USER_MESSAGE_EVENT,
  runStateEventSchema,
} from "@gentic/validators/realtime"

import { sendIssueMessage } from "@/app/issues/actions"
import type { IssuePullRequest } from "@/app/queries"
import { queryKeys } from "@/app/query-keys"

import { AttachmentPromptField } from "../attachment-prompt-field"
import {
  ISSUE_RETRY_RESET_EVENT,
  type IssueRetryResetEventDetail,
} from "./issue-retry-events"

export type ChatMessage = {
  id: string
  // Stable React key that survives the optimistic-id -> server-id swap in
  // the send mutation's onSuccess. Without it, that swap changes the list
  // item's `key` (id), so React unmounts/remounts its DOM node — which
  // resets @shadcn/react's message-scroller anchor tracking and can snap
  // the viewport to the first unhandled anchor message (the top of the
  // conversation) instead of staying put.
  clientKey?: string
  role: "user" | "assistant" | "system"
  kind: "text" | "tool" | "thinking"
  content: string | null
  status: "streaming" | "complete" | "error"
  created_at: string
}

function mergeMessage(list: ChatMessage[], incoming: ChatMessage) {
  const index = list.findIndex((message) => message.id === incoming.id)
  if (index === -1) {
    return [...list, incoming].sort((a, b) =>
      a.created_at.localeCompare(b.created_at)
    )
  }
  const next = [...list]
  const existing = next[index]
  next[index] = {
    ...incoming,
    clientKey: existing.clientKey ?? incoming.clientKey,
  }
  return next
}

function mergeMessages(list: ChatMessage[], incoming: ChatMessage[]) {
  return incoming.reduce(mergeMessage, list)
}

function mergePullRequest(
  list: IssuePullRequest[],
  incoming: IssuePullRequest
) {
  if (list.some((pullRequest) => pullRequest.id === incoming.id)) {
    return list.map((pullRequest) =>
      pullRequest.id === incoming.id ? incoming : pullRequest
    )
  }

  return [incoming, ...list].sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  )
}

function formatPullRequestLabel(url: string) {
  try {
    const [, owner, repo, , number] = new URL(url).pathname.split("/")
    if (owner && repo && number) {
      return `${owner}/${repo}#${number}`
    }
  } catch {
    // Fall back to a generic label for malformed historical data.
  }

  return "Pull request"
}

export function IssueChat({
  issueId,
  initialMessages,
  initialStatus,
  initialUsageLimitResetAt,
  initialPrUrl,
  initialPullRequests,
}: {
  issueId: string
  initialMessages: ChatMessage[]
  initialStatus: IssueStatus
  initialUsageLimitResetAt: string | null
  initialPrUrl: string | null
  initialPullRequests: IssuePullRequest[]
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [status, setStatus] = useState<IssueStatus>(initialStatus)
  const [usageLimitResetAt, setUsageLimitResetAt] = useState<string | null>(
    initialUsageLimitResetAt
  )
  const [prUrl, setPrUrl] = useState<string | null>(initialPrUrl)
  const [pullRequests, setPullRequests] =
    useState<IssuePullRequest[]>(initialPullRequests)
  const [draft, setDraft] = useState("")
  const [draftFiles, setDraftFiles] = useState<File[]>([])
  // Bumped on every submit to trigger a forced scroll-to-bottom, since the
  // scroller's own follow-bottom heuristic only kicks in if the viewport was
  // already at the bottom before the new message landed.
  const [sendTick, setSendTick] = useState(0)
  const queryClient = useQueryClient()
  // The private broadcast channel from the effect below, kept in a ref so
  // `handleSubmit` can send on it without re-subscribing on every render.
  const broadcastChannelRef = useRef<ReturnType<
    ReturnType<typeof useSupabaseClient>["channel"]
  > | null>(null)
  const broadcastSubscribedRef = useRef(false)
  // Last-seen `seq` per message id, so an out-of-order broadcast delivery
  // can't regress a message back to older content.
  const messageSeqRef = useRef(new Map<string, number>())
  const mutation = useMutation({
    mutationFn: sendIssueMessage,
    onMutate: (formData) => {
      const content = String(formData.get("content") ?? "")
      const optimisticId = `optimistic-${crypto.randomUUID()}`

      setMessages((current) =>
        mergeMessage(current, {
          id: optimisticId,
          clientKey: optimisticId,
          role: "user",
          kind: "text",
          content,
          status: "complete",
          created_at: new Date().toISOString(),
        })
      )

      return { optimisticId }
    },
    onSuccess: async (message, formData, context) => {
      const content = String(formData.get("content") ?? "")

      setMessages((current) =>
        mergeMessage(
          current.filter(({ id }) => id !== context.optimisticId),
          {
            id: message.id,
            clientKey: context.optimisticId,
            role: "user",
            kind: "text",
            content,
            status: "complete",
            created_at: message.created_at,
          }
        )
      )

      if (broadcastSubscribedRef.current && broadcastChannelRef.current) {
        void broadcastChannelRef.current.send({
          type: "broadcast",
          event: REALTIME_USER_MESSAGE_EVENT,
          payload: {
            id: message.id,
            content,
            created_at: message.created_at,
          },
        })
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.issue(issueId) })
    },
    onError: (_error, formData, context) => {
      if (context) {
        setMessages((current) =>
          current.filter(({ id }) => id !== context.optimisticId)
        )
      }
      setDraft((current) => current || String(formData.get("content") ?? ""))
    },
  })

  const supabase = useSupabaseClient()
  const isOptimisticRetryReset = initialMessages.some((message) =>
    message.id.startsWith("optimistic-retry-")
  )
  const displayedMessages = useMemo(() => {
    if (isOptimisticRetryReset) {
      return initialMessages
    }

    return mergeMessages(
      messages.filter((message) => !message.id.startsWith("optimistic-retry-")),
      initialMessages
    )
  }, [messages, initialMessages, isOptimisticRetryReset])
  const displayedPullRequests = useMemo(
    () => initialPullRequests.reduce(mergePullRequest, pullRequests),
    [pullRequests, initialPullRequests]
  )

  useEffect(() => {
    function handleRetryReset(event: Event) {
      const { detail } = event as CustomEvent<IssueRetryResetEventDetail>
      if (detail.issueId !== issueId) {
        return
      }

      setMessages([detail.message])
      setStatus(detail.status)
      setUsageLimitResetAt(detail.usageLimitResetAt)
      setPrUrl(detail.prUrl)
      setPullRequests(detail.pullRequests)
    }

    window.addEventListener(ISSUE_RETRY_RESET_EVENT, handleRetryReset)
    return () => {
      window.removeEventListener(ISSUE_RETRY_RESET_EVENT, handleRetryReset)
    }
  }, [issueId])
  // The worker only starts streaming a message once the model produces its
  // first token — cloning, running the setup script, and booting the ACP
  // session all happen first with no message to attach a spinner to. Show a
  // standalone marker for that gap so "agent is working" isn't silent.
  const isAgentWorkingWithoutMessage =
    (status === "queued" || status === "in-progress") &&
    !displayedMessages.some((message) => message.status === "streaming")

  useEffect(() => {
    const channel = supabase
      .channel(`issue-${issueId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `issue_id=eq.${issueId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const removed = payload.old as { id: string }
            setMessages((current) =>
              current.filter((message) => message.id !== removed.id)
            )
            return
          }
          setMessages((current) =>
            mergeMessage(current, payload.new as ChatMessage)
          )
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "issues",
          filter: `id=eq.${issueId}`,
        },
        (payload) => {
          const next = payload.new as {
            status: IssueStatus
            usage_limit_reset_at: string | null
            pr_url: string | null
          }
          setStatus(next.status)
          setUsageLimitResetAt(next.usage_limit_reset_at)
          setPrUrl(next.pr_url)
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "issue_pull_requests",
          filter: `issue_id=eq.${issueId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const removed = payload.old as { id: string }
            setPullRequests((current) =>
              current.filter((pullRequest) => pullRequest.id !== removed.id)
            )
            return
          }
          setPullRequests((current) =>
            mergePullRequest(current, payload.new as IssuePullRequest)
          )
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [supabase, issueId])

  // Private Realtime Broadcast channel: the low-latency transport (see
  // docs/realtime-transport.md). Subscribed in addition to the
  // `postgres_changes` effect above during rollout — upsert-by-id makes
  // double delivery of the same message harmless.
  useEffect(() => {
    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function join() {
      await supabase.realtime.setAuth()
      if (cancelled) {
        return
      }

      channel = supabase
        .channel(issueRealtimeTopic(issueId), { config: { private: true } })
        .on(
          "broadcast",
          { event: REALTIME_MESSAGE_EVENT },
          ({ payload }) => {
            const event = messageEventSchema.safeParse(payload)
            if (!event.success) {
              return
            }
            const lastSeq = messageSeqRef.current.get(event.data.id) ?? 0
            if (event.data.seq <= lastSeq) {
              return
            }
            messageSeqRef.current.set(event.data.id, event.data.seq)
            setMessages((current) =>
              mergeMessage(current, {
                id: event.data.id,
                role: event.data.role,
                kind: event.data.kind,
                content: event.data.content,
                status: event.data.status,
                created_at: event.data.ts,
              })
            )
          }
        )
        .on(
          "broadcast",
          { event: REALTIME_RUN_STATE_EVENT },
          ({ payload }) => {
            const event = runStateEventSchema.safeParse(payload)
            if (!event.success) {
              return
            }
            setStatus(event.data.status)
            setUsageLimitResetAt(event.data.usage_limit_reset_at)
            setPrUrl(event.data.pr_url)
          }
        )
        .subscribe((subscribeStatus) => {
          broadcastSubscribedRef.current = subscribeStatus === "SUBSCRIBED"
        })

      broadcastChannelRef.current = channel
    }

    void join()

    return () => {
      cancelled = true
      broadcastSubscribedRef.current = false
      broadcastChannelRef.current = null
      if (channel) {
        void supabase.removeChannel(channel)
      }
    }
  }, [supabase, issueId])

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || mutation.isPending) {
      return
    }

    const formData = new FormData()
    formData.set("issue_id", issueId)
    formData.set("content", content)
    for (const file of draftFiles) {
      formData.append("files", file)
    }
    setDraft("")
    setDraftFiles([])
    setSendTick((tick) => tick + 1)
    mutation.mutate(formData)
  }

  return (
    <div className="flex flex-col gap-4">
      {(usageLimitResetAt && status === "held") ||
      prUrl ||
      displayedPullRequests.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {usageLimitResetAt && status === "held" ? (
            <div className="inline-flex h-7 w-fit items-center gap-1 rounded-full bg-muted px-2.5 text-xs font-medium text-muted-foreground">
              Resets {formatDateTime(usageLimitResetAt)}
            </div>
          ) : null}
          {displayedPullRequests.map((pullRequest) => (
            <a
              key={pullRequest.id}
              href={pullRequest.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 w-fit items-center gap-1 rounded-full bg-indigo-500/15 px-2.5 text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300"
            >
              <IconGitPullRequest className="size-3.5" />
              {formatPullRequestLabel(pullRequest.url)}
              <IconExternalLink className="size-3.5" />
            </a>
          ))}
          {prUrl && displayedPullRequests.length === 0 ? (
            <a
              href={prUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 w-fit items-center gap-1 rounded-full bg-indigo-500/15 px-2.5 text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300"
            >
              <IconGitPullRequest className="size-3.5" />
              {formatPullRequestLabel(prUrl)}
              <IconExternalLink className="size-3.5" />
            </a>
          ) : null}
        </div>
      ) : null}

      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <ScrollToEndOnSend sendTick={sendTick} />
        <MessageScroller className="h-[28rem] max-h-[28rem]">
          <MessageScrollerViewport className="pr-1">
            <MessageScrollerContent className="gap-3">
              {displayedMessages.length === 0 ? (
                <MessageScrollerItem messageId="empty">
                  <Marker variant="border">
                    <MarkerContent>
                      No messages yet. Move this issue to Queued to start the
                      agent.
                    </MarkerContent>
                  </Marker>
                </MessageScrollerItem>
              ) : (
                displayedMessages.map((message) => (
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

      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <AttachmentPromptField
          key={sendTick}
          value={draft}
          onChange={setDraft}
          onFilesChange={setDraftFiles}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
          rows={2}
          placeholder="Message the agent…"
          disabled={mutation.isPending}
          className="min-w-0 flex-1"
          textareaClassName="min-h-18 resize-none"
        />
        <Button
          type="submit"
          size="icon"
          disabled={mutation.isPending || !draft.trim()}
        >
          <IconSend />
        </Button>
      </form>
    </div>
  )
}

// Forces the viewport to the bottom on every send, even if the scroller's
// own follow-bottom tracking had lapsed (e.g. the user had scrolled up to
// read history before sending). Must render inside MessageScrollerProvider.
function ScrollToEndOnSend({ sendTick }: { sendTick: number }) {
  const { scrollToEnd } = useMessageScroller()

  useEffect(() => {
    if (sendTick > 0) {
      scrollToEnd({ behavior: "smooth" })
    }
  }, [sendTick, scrollToEnd])

  return null
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
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
