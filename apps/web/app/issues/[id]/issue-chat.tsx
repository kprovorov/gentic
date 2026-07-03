"use client"

import { useEffect, useRef, useState } from "react"
import { useTransition } from "react"
import { IconSend } from "@tabler/icons-react"

import { useSupabaseClient } from "@gentic/supabase/client"
import { Button } from "@gentic/ui/button"
import { cn } from "@gentic/ui/utils"

import { sendIssueMessage } from "@/app/issues/actions"

export type ChatMessage = {
  id: string
  role: "user" | "assistant" | "system"
  kind: "text" | "tool" | "thinking"
  content: string | null
  status: "streaming" | "complete" | "error"
  created_at: string
}

export type RunStatus =
  | "queued"
  | "cloning"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | null

const runStatusLabels: Record<NonNullable<RunStatus>, string> = {
  queued: "Queued",
  cloning: "Cloning repo",
  running: "Agent running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
}

const runStatusStyles: Record<NonNullable<RunStatus>, string> = {
  queued: "bg-muted text-muted-foreground",
  cloning: "bg-primary/15 text-primary-foreground",
  running: "bg-primary/15 text-primary-foreground",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  failed: "bg-destructive/15 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
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

export function IssueChat({
  issueId,
  initialMessages,
  initialRunStatus,
}: {
  issueId: string
  initialMessages: ChatMessage[]
  initialRunStatus: RunStatus
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [runStatus, setRunStatus] = useState<RunStatus>(initialRunStatus)
  const [draft, setDraft] = useState("")
  const [isPending, startTransition] = useTransition()
  const scrollRef = useRef<HTMLDivElement>(null)

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
          setRunStatus((payload.new as { run_status: RunStatus }).run_status)
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [supabase, issueId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages])

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || isPending) {
      return
    }

    const formData = new FormData()
    formData.set("issue_id", issueId)
    formData.set("content", content)
    setDraft("")
    startTransition(() => {
      void sendIssueMessage(formData)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {runStatus ? (
        <div
          className={cn(
            "inline-flex h-7 w-fit items-center gap-1 rounded-full px-2.5 text-xs font-medium",
            runStatusStyles[runStatus]
          )}
        >
          {runStatusLabels[runStatus]}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto"
      >
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No messages yet. Move this issue to Todo to start the agent.
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
          className="min-h-9 w-full resize-none rounded-3xl border border-transparent bg-input/50 px-4 py-2 text-sm transition-[color,box-shadow,background-color] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30"
        />
        <Button type="submit" size="icon" disabled={isPending || !draft.trim()}>
          <IconSend />
        </Button>
      </form>
    </div>
  )
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
