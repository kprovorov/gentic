"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  IconExternalLink,
  IconGitPullRequest,
  IconLoader2,
  IconRefresh,
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
import type { AgentProvider, IssueStatus } from "@gentic/validators/issues"
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
import { type ChatMessage, useIssueChat } from "./issue-chat-state"

type SlashCommand = {
  name: string
  description: string
}

const CLAUDE_CODE_SLASH_COMMANDS: SlashCommand[] = [
  { name: "/init", description: "Generate or update project memory" },
  { name: "/memory", description: "Edit Claude memory files" },
  { name: "/mcp", description: "Manage MCP servers" },
  { name: "/permissions", description: "Change tool approval rules" },
  { name: "/plan", description: "Switch to planning mode" },
  { name: "/model", description: "Change the active model" },
  { name: "/effort", description: "Adjust reasoning effort" },
  { name: "/context", description: "Inspect context usage" },
  { name: "/compact", description: "Compact conversation history" },
  { name: "/clear", description: "Clear conversation context" },
  { name: "/diff", description: "Show current changes" },
  { name: "/review", description: "Review a pull request" },
  { name: "/code-review", description: "Review code changes" },
  { name: "/security-review", description: "Review security risk" },
  { name: "/tasks", description: "List background tasks" },
  { name: "/help", description: "Show available commands" },
]

const CODEX_SLASH_COMMANDS: SlashCommand[] = [
  { name: "/permissions", description: "Change approval rules" },
  { name: "/model", description: "Change the active model" },
  { name: "/reasoning", description: "Adjust reasoning effort" },
  { name: "/status", description: "Show task and context status" },
  { name: "/plan", description: "Toggle plan mode" },
  { name: "/compact", description: "Compact task context" },
  { name: "/review", description: "Start code review mode" },
  { name: "/init", description: "Generate AGENTS.md guidance" },
  { name: "/mcp", description: "Open MCP status" },
  { name: "/goal", description: "Set a persistent goal" },
  { name: "/agent", description: "Switch agent thread" },
  { name: "/subagents", description: "Switch agent thread" },
  { name: "/side", description: "Start a side conversation" },
  { name: "/ide", description: "Include IDE context" },
  { name: "/ide-context", description: "Toggle IDE context" },
  { name: "/fast", description: "Toggle fast service tier" },
  { name: "/feedback", description: "Send product feedback" },
  { name: "/local", description: "Run locally" },
  { name: "/cloud", description: "Run in the cloud" },
  { name: "/help", description: "Show available commands" },
]

function slashCommandsForProvider(provider: AgentProvider): SlashCommand[] {
  return provider === "codex"
    ? CODEX_SLASH_COMMANDS
    : CLAUDE_CODE_SLASH_COMMANDS
}

function slashCommandQuery(value: string): string | null {
  if (!value.startsWith("/")) {
    return null
  }
  const firstLine = value.split("\n", 1)[0] ?? ""
  if (firstLine.includes(" ")) {
    return null
  }
  return firstLine.toLowerCase()
}

function filterSlashCommands(
  commands: SlashCommand[],
  query: string
): SlashCommand[] {
  return commands
    .filter((command) => command.name.toLowerCase().startsWith(query))
    .slice(0, 8)
}

type RealtimeConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"

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
  // Bumped on every submit to trigger a forced scroll-to-bottom, since the
  // scroller's own follow-bottom heuristic only kicks in if the viewport was
  // already at the bottom before the new message landed.
  const [sendTick, setSendTick] = useState(0)
  const [liveMessage, setLiveMessage] = useState("")
  const [connectionStatus, setConnectionStatus] =
    useState<RealtimeConnectionStatus>("connecting")
  const queryClient = useQueryClient()
  // The private broadcast channel from the effect below, kept in a ref so
  // `handleSubmit` can send on it without re-subscribing on every render.
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
          },
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

  const supabase = useSupabaseClient()
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
  const showSlashCommands =
    slashQuery !== null && matchingSlashCommands.length > 0
  const boundedSlashCommandIndex =
    matchingSlashCommands.length === 0
      ? 0
      : Math.min(selectedSlashCommandIndex, matchingSlashCommands.length - 1)

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

  // The worker only starts streaming a message once the model produces its
  // first token — cloning, running the setup script, and booting the ACP
  // session all happen first with no message to attach a spinner to. Show a
  // standalone marker for that gap so "agent is working" isn't silent. Once a
  // completed assistant text message is last in the transcript, suppress the
  // marker even if issue status is briefly stale: that message is the agent's
  // visible turn boundary, and a marker beneath it reads as lingering work.
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

  // Private Realtime Broadcast channel: the low-latency transcript transport
  // (see docs/realtime-transport.md). Durable query hydration reconciles any
  // missed persisted messages on initial load, navigation, and reconnect.
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

  return (
    <div className="flex flex-col gap-4">
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {liveMessage}
      </div>
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
                    <ChatMessageRow
                      message={message}
                      isLatestUserMessage={message.id === lastDisplayedMessage?.id}
                      issueStatus={status}
                      onRetry={retryFailedMessage}
                      retryDisabled={mutation.isPending}
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

      {connectionMessage ? (
        <div
          className={cn(
            "rounded-lg border px-3 py-2 text-sm",
            connectionStatus === "connected"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          )}
          role={connectionStatus === "connected" ? "status" : "alert"}
          aria-live="polite"
        >
          {connectionMessage}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <div className="relative min-w-0 flex-1">
          {showSlashCommands ? (
            <SlashCommandMenu
              commands={matchingSlashCommands}
              selectedIndex={boundedSlashCommandIndex}
              onSelect={selectSlashCommand}
            />
          ) : null}
          <AttachmentPromptField
            value={draft}
            onChange={(value) => {
              setDraft(value)
              setSelectedSlashCommandIndex(0)
            }}
            files={draftFiles}
            onFilesChange={setDraftFiles}
            onKeyDown={handlePromptKeyDown}
            rows={2}
            placeholder="Message the agent…"
            disabled={mutation.isPending}
            className="min-w-0"
            textareaClassName="min-h-18 resize-none"
          />
        </div>
        <Button
          type="submit"
          size="icon"
          aria-label={
            mutation.isPending ? "Sending message" : "Send message to agent"
          }
          disabled={mutation.isPending || !draft.trim()}
        >
          <IconSend />
        </Button>
      </form>
    </div>
  )
}

function SlashCommandMenu({
  commands,
  selectedIndex,
  onSelect,
}: {
  commands: SlashCommand[]
  selectedIndex: number
  onSelect: (command: SlashCommand) => void
}) {
  return (
    <div className="absolute right-0 bottom-full left-0 z-20 mb-2 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg">
      <div className="max-h-72 overflow-y-auto p-1">
        {commands.map((command, index) => (
          <button
            key={command.name}
            type="button"
            className={cn(
              "grid w-full grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 rounded-lg px-3 py-2 text-left text-sm",
              index === selectedIndex
                ? "bg-accent text-accent-foreground"
                : "hover:bg-accent hover:text-accent-foreground"
            )}
            onMouseDown={(event) => {
              event.preventDefault()
              onSelect(command)
            }}
          >
            <span className="font-mono font-medium">{command.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {command.description}
            </span>
          </button>
        ))}
      </div>
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
