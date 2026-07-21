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
  type UserMessageEvent,
} from "@gentic/validators/realtime"

import { sendIssueMessage } from "@/app/issues/actions"
import type { IssuePullRequest } from "@/app/queries"
import { queryKeys } from "@/app/query-keys"

import {
  ISSUE_RETRY_RESET_EVENT,
  type IssueRetryResetEventDetail,
} from "../issue-retry-events"
import { useIssueChat } from "../issue-chat-state"
import {
  parseDeletedRow,
  parseIssuePullRequestRow,
  parseIssueRunStateRow,
  parseMessageEventPayload,
  parseRunStatePayload,
} from "./event-mapping"
import { mergePullRequest } from "./pull-requests"
import {
  filterSlashCommands,
  slashCommandName,
  slashCommandQuery,
  slashCommandsForProvider,
  slashCommandsFromMessages,
  type SlashCommand,
} from "./slash-commands"
import type { ChatMessage, RealtimeConnectionStatus } from "./types"

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
  const { messages: displayedMessages, dispatch } =
    useIssueChat(initialMessages)
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
  const [liveMessage, setLiveMessage] = useState("")
  const [connectionStatus, setConnectionStatus] =
    useState<RealtimeConnectionStatus>("connecting")

  const queryClient = useQueryClient()
  const supabase = useSupabaseClient()
  const broadcastChannelRef = useRef<ReturnType<
    ReturnType<typeof useSupabaseClient>["channel"]
  > | null>(null)
  const broadcastSubscribedRef = useRef(false)
  const announcedAssistantMessageRef = useRef<string | null>(null)
  const connectionStatusRef =
    useRef<RealtimeConnectionStatus>(connectionStatus)

  function setRealtimeConnectionStatus(
    nextStatus: RealtimeConnectionStatus,
    announcement?: string
  ) {
    connectionStatusRef.current = nextStatus
    setConnectionStatus(nextStatus)
    if (announcement) {
      setLiveMessage(announcement)
    }
  }

  const mutation = useMutation({
    mutationFn: sendIssueMessage,
    onMutate: (formData) => {
      const content = String(formData.get("content") ?? "")
      const retryId = String(formData.get("client_message_id") ?? "")
      const optimisticId = retryId.startsWith("optimistic-")
        ? retryId
        : `optimistic-${crypto.randomUUID()}`
      const files = formData
        .getAll("files")
        .filter((value): value is File => value instanceof File)

      dispatch({
        type: "optimistic_send",
        message: {
          id: optimisticId,
          clientKey: optimisticId,
          role: "user",
          kind: "text",
          content,
          status: "complete",
          created_at: new Date().toISOString(),
          retryContent: content,
          retryFiles: files,
          attachments: files
            .filter((file) => file.size > 0)
            .map((file) => ({
              id: `optimistic-${crypto.randomUUID()}`,
              fileName: file.name,
              sizeBytes: file.size,
              url: null,
              thumbnailUrl: null,
            })),
        },
      })
      setLiveMessage("Sending message.")

      return { optimisticId }
    },
    onSuccess: async (message, formData, context) => {
      const content = String(formData.get("content") ?? "")

      dispatch({
        type: "persisted_insert_update",
        optimisticId: context.optimisticId,
        message: {
          id: message.id,
          clientKey: context.optimisticId,
          role: "user",
          kind: "text",
          content,
          status: "complete",
          created_at: message.created_at,
          attachments: message.attachments,
        },
      })
      setLiveMessage("Message delivered. Agent will process it shortly.")

      if (broadcastSubscribedRef.current && broadcastChannelRef.current) {
        void broadcastChannelRef.current.send({
          type: "broadcast",
          event: REALTIME_USER_MESSAGE_EVENT,
          payload: {
            id: message.id,
            content,
            created_at: message.created_at,
          } satisfies UserMessageEvent,
        })
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.issue(issueId) })
    },
    onError: (_error, formData, context) => {
      const content = String(formData.get("content") ?? "")
      const files = formData
        .getAll("files")
        .filter((value): value is File => value instanceof File)
      const error = getSendErrorMessage(_error)
      if (context) {
        dispatch({
          type: "failure",
          optimisticId: context.optimisticId,
          error,
          content,
          files,
        })
      }
      setDraft((current) => current || content)
      setDraftFiles((current) => (current.length > 0 ? current : files))
      setLiveMessage(`Message failed to send. ${error}`)
    },
  })

  const displayedPullRequests = useMemo(
    () => initialPullRequests.reduce(mergePullRequest, pullRequests),
    [pullRequests, initialPullRequests]
  )
  const slashCommands = useMemo(
    () =>
      slashCommandsFromMessages(displayedMessages) ??
      slashCommandsForProvider(agentProvider),
    [displayedMessages, agentProvider]
  )
  const hasAcpSlashCommands = useMemo(
    () => slashCommandsFromMessages(displayedMessages) !== null,
    [displayedMessages]
  )
  const slashQuery = slashCommandQuery(draft)
  const slashNameInDraft = slashCommandName(draft)
  const invalidSlashCommand =
    hasAcpSlashCommands &&
    slashNameInDraft !== null &&
    !slashCommands.some(
      (command) => command.name.toLowerCase() === slashNameInDraft
    )
  const matchingSlashCommands = useMemo(
    () =>
      slashQuery === null
        ? []
        : filterSlashCommands(slashCommands, slashQuery),
    [slashCommands, slashQuery]
  )
  const showSlashCommands =
    slashQuery !== null && matchingSlashCommands.length > 0
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
  const connectionMessage = getConnectionMessage(connectionStatus)

  useEffect(() => {
    function handleRetryReset(event: Event) {
      const { detail } = event as CustomEvent<IssueRetryResetEventDetail>
      if (detail.issueId !== issueId) {
        return
      }

      dispatch({ type: "reset", messages: [detail.message] })
      setStatus(detail.status)
      setUsageLimitResetAt(detail.usageLimitResetAt)
      setPrUrl(detail.prUrl)
      setPullRequests(detail.pullRequests)
    }

    window.addEventListener(ISSUE_RETRY_RESET_EVENT, handleRetryReset)
    return () => {
      window.removeEventListener(ISSUE_RETRY_RESET_EVENT, handleRetryReset)
    }
  }, [dispatch, issueId])

  useEffect(() => {
    const lastAssistant = displayedMessages.findLast(
      (message) =>
        message.role === "assistant" &&
        message.kind === "text" &&
        message.status === "complete"
    )
    if (!lastAssistant) {
      return
    }
    if (announcedAssistantMessageRef.current === lastAssistant.id) {
      return
    }
    announcedAssistantMessageRef.current = lastAssistant.id
    setLiveMessage("Agent response complete.")
  }, [displayedMessages])

  useEffect(() => {
    function updateOnlineStatus() {
      if (!navigator.onLine) {
        setRealtimeConnectionStatus(
          "offline",
          "You are offline. You can keep composing."
        )
        return
      }
      if (connectionStatusRef.current === "offline") {
        setRealtimeConnectionStatus(
          "reconnecting",
          "Realtime connection lost. Reconnecting."
        )
      }
    }

    updateOnlineStatus()
    window.addEventListener("online", updateOnlineStatus)
    window.addEventListener("offline", updateOnlineStatus)
    return () => {
      window.removeEventListener("online", updateOnlineStatus)
      window.removeEventListener("offline", updateOnlineStatus)
    }
  }, [])

  useEffect(() => {
    const channel = supabase
      .channel(`issue-${issueId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "issues",
          filter: `id=eq.${issueId}`,
        },
        (payload) => {
          const next = parseIssueRunStateRow(payload.new)
          if (!next.success) {
            return
          }
          setStatus(next.data.status)
          setUsageLimitResetAt(next.data.usage_limit_reset_at)
          setPrUrl(next.data.pr_url)
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
            const removed = parseDeletedRow(payload.old)
            if (!removed.success) {
              return
            }
            setPullRequests((current) =>
              current.filter((pullRequest) => pullRequest.id !== removed.data.id)
            )
            return
          }
          const pullRequest = parseIssuePullRequestRow(payload.new)
          if (!pullRequest.success) {
            return
          }
          setPullRequests((current) =>
            mergePullRequest(current, pullRequest.data)
          )
        }
      )
      .subscribe((subscribeStatus) => {
        if (subscribeStatus === "SUBSCRIBED") {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.issue(issueId),
          })
        }
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [supabase, issueId, queryClient])

  // Private Realtime Broadcast channel: the low-latency transcript transport.
  // Durable query hydration reconciles missed persisted messages on reconnect.
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
            const event = parseMessageEventPayload(payload)
            if (!event.success) {
              return
            }
            dispatch({
              type:
                event.data.status === "streaming"
                  ? "stream_delta"
                  : "finalization",
              event: event.data,
            })
          }
        )
        .on(
          "broadcast",
          { event: REALTIME_RUN_STATE_EVENT },
          ({ payload }) => {
            const event = parseRunStatePayload(payload)
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
          if (typeof navigator !== "undefined" && !navigator.onLine) {
            setRealtimeConnectionStatus(
              "offline",
              "You are offline. You can keep composing."
            )
            return
          }
          if (subscribeStatus === "SUBSCRIBED") {
            setRealtimeConnectionStatus(
              "connected",
              connectionStatusRef.current === "connected"
                ? undefined
                : "Realtime connection restored."
            )
            return
          }
          if (subscribeStatus === "TIMED_OUT" || subscribeStatus === "CLOSED") {
            setRealtimeConnectionStatus(
              "reconnecting",
              "Realtime connection lost. Reconnecting."
            )
            return
          }
          if (subscribeStatus === "CHANNEL_ERROR") {
            if (connectionStatusRef.current === "connected") {
              setRealtimeConnectionStatus(
                "reconnecting",
                "Realtime connection lost. Reconnecting."
              )
              return
            }
            setRealtimeConnectionStatus("connecting")
          }
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
  }, [supabase, issueId, dispatch])

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || mutation.isPending || invalidSlashCommand) {
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

  function retryFailedMessage(message: ChatMessage) {
    if (mutation.isPending) {
      return
    }

    const content = message.retryContent ?? message.content ?? ""
    const formData = new FormData()
    formData.set("issue_id", issueId)
    formData.set("content", content)
    formData.set("client_message_id", message.id)
    for (const file of message.retryFiles ?? []) {
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
    if (showSlashCommands) {
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
    connectionStatus,
    connectionMessage,
    liveMessage,
    draft,
    draftFiles,
    sendTick,
    isSending: mutation.isPending,
    invalidSlashCommand,
    visibleSlashCommands: showSlashCommands ? matchingSlashCommands : [],
    boundedSlashCommandIndex,
    setDraftFiles,
    handleDraftChange,
    handlePromptKeyDown,
    handleSubmit,
    retryFailedMessage,
    selectSlashCommand,
  }
}

function getSendErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return "Your message was not delivered."
}

function getConnectionMessage(status: RealtimeConnectionStatus) {
  if (status === "offline") {
    return "Offline. You can keep composing, but sends may fail until the connection returns."
  }
  if (status === "reconnecting") {
    return "Reconnecting to live updates. You can keep composing while we recover."
  }
  if (status === "connecting") {
    return "Connecting to live updates..."
  }
  return null
}
