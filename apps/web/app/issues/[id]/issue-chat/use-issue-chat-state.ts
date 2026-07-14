"use client"

import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { useSupabaseClient } from "@gentic/supabase/client"
import type { AgentProvider, IssueStatus } from "@gentic/validators/issues"
import {
  issueRealtimeTopic,
  REALTIME_MESSAGE_EVENT,
  REALTIME_RUN_STATE_EVENT,
  REALTIME_USER_MESSAGE_EVENT,
} from "@gentic/validators/realtime"

import { sendIssueMessage } from "@/app/issues/actions"
import type { IssuePullRequest } from "@/app/queries"
import { queryKeys } from "@/app/query-keys"

import {
  ISSUE_RETRY_RESET_EVENT,
  type IssueRetryResetEventDetail,
} from "../issue-retry-events"
import {
  messageFromRealtimePayload,
  realtimeMessageSeq,
  runStateFromRealtimePayload,
} from "./event-mapping"
import {
  displayedChatMessages,
  mergeMessage,
} from "./message-state"
import { mergePullRequest } from "./pull-requests"
import {
  filterSlashCommands,
  slashCommandQuery,
  slashCommandsForProvider,
  type SlashCommand,
} from "./slash-commands"
import type { ChatMessage } from "./types"

export function useIssueChatState({
  issueId,
  agentProvider,
  initialMessages,
  initialStatus,
  initialUsageLimitResetAt,
  initialPrUrl,
  initialPullRequests,
}: {
  issueId: string
  agentProvider: AgentProvider
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
  const [selectedSlashCommandIndex, setSelectedSlashCommandIndex] = useState(0)
  const [sendTick, setSendTick] = useState(0)

  const queryClient = useQueryClient()
  const supabase = useSupabaseClient()
  const broadcastChannelRef = useRef<ReturnType<
    ReturnType<typeof useSupabaseClient>["channel"]
  > | null>(null)
  const broadcastSubscribedRef = useRef(false)
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

  const displayedMessages = useMemo(
    () => displayedChatMessages({ messages, initialMessages }),
    [messages, initialMessages]
  )
  const displayedPullRequests = useMemo(
    () => initialPullRequests.reduce(mergePullRequest, pullRequests),
    [pullRequests, initialPullRequests]
  )
  const slashCommands = useMemo(
    () => slashCommandsForProvider(agentProvider),
    [agentProvider]
  )
  const slashQuery = slashCommandQuery(draft)
  const matchingSlashCommands = useMemo(
    () =>
      slashQuery === null
        ? []
        : filterSlashCommands(slashCommands, slashQuery),
    [slashCommands, slashQuery]
  )
  const boundedSlashCommandIndex =
    matchingSlashCommands.length === 0
      ? 0
      : Math.min(selectedSlashCommandIndex, matchingSlashCommands.length - 1)

  const lastDisplayedMessage = displayedMessages.at(-1)
  const hasStreamingMessage = displayedMessages.some(
    (message) => message.status === "streaming"
  )
  const lastMessageCompletedAssistantTurn =
    lastDisplayedMessage?.role === "assistant" &&
    lastDisplayedMessage.kind === "text" &&
    lastDisplayedMessage.status !== "streaming"
  const isAgentWorkingWithoutMessage =
    (status === "queued" || status === "in-progress") &&
    !hasStreamingMessage &&
    !lastMessageCompletedAssistantTurn

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

  // Private Realtime Broadcast channel: the low-latency transport documented in
  // docs/realtime-transport.md. Kept with postgres_changes during rollout;
  // upsert-by-id makes double delivery harmless.
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
            const seq = realtimeMessageSeq(payload)
            if (!seq) {
              return
            }
            const lastSeq = messageSeqRef.current.get(seq.id) ?? 0
            if (seq.seq <= lastSeq) {
              return
            }
            const message = messageFromRealtimePayload(payload)
            if (!message) {
              return
            }
            messageSeqRef.current.set(seq.id, seq.seq)
            setMessages((current) => mergeMessage(current, message))
          }
        )
        .on(
          "broadcast",
          { event: REALTIME_RUN_STATE_EVENT },
          ({ payload }) => {
            const runState = runStateFromRealtimePayload(payload)
            if (!runState) {
              return
            }
            setStatus(runState.status)
            setUsageLimitResetAt(runState.usageLimitResetAt)
            setPrUrl(runState.prUrl)
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

  function selectSlashCommand(command: SlashCommand) {
    setDraft(`${command.name} `)
    setSelectedSlashCommandIndex(0)
  }

  function handleDraftChange(value: string) {
    setDraft(value)
    setSelectedSlashCommandIndex(0)
  }

  function handlePromptKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (matchingSlashCommands.length > 0 && slashQuery !== null) {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setSelectedSlashCommandIndex(
          (index) => (index + 1) % matchingSlashCommands.length
        )
        return
      }

      if (event.key === "ArrowUp") {
        event.preventDefault()
        setSelectedSlashCommandIndex(
          (index) =>
            (index - 1 + matchingSlashCommands.length) %
            matchingSlashCommands.length
        )
        return
      }

      if (event.key === "Tab") {
        event.preventDefault()
        selectSlashCommand(matchingSlashCommands[boundedSlashCommandIndex])
        return
      }

      if (event.key === "Escape") {
        event.preventDefault()
        setDraft("")
        setSelectedSlashCommandIndex(0)
        return
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return {
    status,
    usageLimitResetAt,
    prUrl,
    displayedMessages,
    displayedPullRequests,
    isAgentWorkingWithoutMessage,
    draft,
    sendTick,
    isSending: mutation.isPending,
    visibleSlashCommands:
      slashQuery !== null && matchingSlashCommands.length > 0
        ? matchingSlashCommands
        : [],
    boundedSlashCommandIndex,
    setDraftFiles,
    handleDraftChange,
    handlePromptKeyDown,
    handleSubmit,
    selectSlashCommand,
  }
}
