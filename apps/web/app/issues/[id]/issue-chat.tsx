"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  IconExternalLink,
  IconGitPullRequest,
  IconSend,
} from "@tabler/icons-react"

import { useSupabaseClient } from "@gentic/supabase/client"
import { Button } from "@gentic/ui/button"
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

export type ChatMessage = {
  id: string
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
  next[index] = incoming
  return next
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
  const scrollRef = useRef<HTMLDivElement>(null)
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
    onSuccess: async (message, formData) => {
      if (broadcastSubscribedRef.current && broadcastChannelRef.current) {
        void broadcastChannelRef.current.send({
          type: "broadcast",
          event: REALTIME_USER_MESSAGE_EVENT,
          payload: {
            id: message.id,
            content: String(formData.get("content") ?? ""),
            created_at: message.created_at,
          },
        })
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.issue(issueId) })
    },
  })

  const supabase = useSupabaseClient()

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

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || mutation.isPending) {
      return
    }

    const formData = new FormData()
    formData.set("issue_id", issueId)
    formData.set("content", content)
    setDraft("")
    mutation.mutate(formData)
  }

  return (
    <div className="flex flex-col gap-4">
      {(usageLimitResetAt && status === "held") ||
      prUrl ||
      pullRequests.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {usageLimitResetAt && status === "held" ? (
            <div className="inline-flex h-7 w-fit items-center gap-1 rounded-full bg-muted px-2.5 text-xs font-medium text-muted-foreground">
              Resets {formatDateTime(usageLimitResetAt)}
            </div>
          ) : null}
          {pullRequests.map((pullRequest) => (
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
          {prUrl && pullRequests.length === 0 ? (
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

      <div
        ref={scrollRef}
        className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto"
      >
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No messages yet. Move this issue to Queued to start the agent.
          </p>
        ) : (
          messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }
          }}
          rows={2}
          placeholder="Message the agent…"
          className="min-h-9 w-full resize-none rounded-3xl border border-transparent bg-input/50 px-4 py-2 text-base transition-[color,box-shadow,background-color] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 md:text-sm"
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

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user"
  const isTool = message.kind === "tool"

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap",
          isUser
            ? "bg-primary/15 text-primary-foreground"
            : isTool
              ? "bg-muted/60 font-mono text-xs text-muted-foreground"
              : "bg-muted text-foreground",
          message.status === "error" && "bg-destructive/15 text-destructive"
        )}
      >
        {message.content}
        {message.status === "streaming" ? (
          <span className="ml-0.5 animate-pulse">▍</span>
        ) : null}
      </div>
    </div>
  )
}
