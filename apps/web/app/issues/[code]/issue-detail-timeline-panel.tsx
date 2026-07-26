"use client"

import { useMemo } from "react"
import { useUser } from "@clerk/nextjs"

import type { IssuePullRequest } from "@/app/queries"
import { cn } from "@gentic/ui/utils"
import type { AgentProvider, IssueStatus } from "@gentic/validators/issues"
import type { IssueEventContract } from "@gentic/validators/realtime"

import { MessageComposer } from "../message-composer/message-composer"
import { useIssueAgentProvider } from "../message-composer/use-issue-agent-provider"
import type { Attachment } from "./attachments"
import type { ChatMessage } from "./issue-chat-state"
import { useIssueChatState } from "./issue-chat/use-issue-chat-state"
import type { RealtimeConnectionStatus } from "./issue-chat/types"
import { buildIssueTimeline } from "./issue-timeline/build-timeline"
import { IssueTimeline } from "./issue-timeline/issue-timeline"

// Wires the message pipeline that used to feed IssueChat (issue-chat/*) into
// the redesigned timeline + composer instead: same realtime message state
// and slash-command handling, rendered through IssueTimeline/MessageComposer.
export function IssueDetailTimelinePanel({
  issueId,
  issueCreatedAt,
  issuePrompt,
  agentProvider,
  initialMessages,
  initialStatus,
  initialUsageLimitResetAt,
  initialPrUrl,
  initialPullRequests,
  attachments,
  events,
}: {
  issueId: string
  issueCreatedAt: string
  issuePrompt: string | null
  agentProvider: AgentProvider
  initialMessages: ChatMessage[]
  initialStatus: IssueStatus
  initialUsageLimitResetAt: string | null
  initialPrUrl: string | null
  initialPullRequests: IssuePullRequest[]
  attachments: Attachment[]
  events: IssueEventContract[]
}) {
  const chat = useIssueChatState({
    issueId,
    agentProvider,
    initialMessages,
    initialStatus,
    initialUsageLimitResetAt,
    initialPrUrl,
    initialPullRequests,
  })
  const { onAgentProviderChange, isPending: isAgentProviderPending } =
    useIssueAgentProvider({ issueId })
  const { user } = useUser()
  const currentUserName =
    user?.fullName ?? user?.primaryEmailAddress?.emailAddress

  const timelineItems = useMemo(
    () =>
      buildIssueTimeline({
        issue: { created_at: issueCreatedAt },
        messages: chat.displayedMessages,
        events,
      }),
    [issueCreatedAt, chat.displayedMessages, events]
  )

  return (
    <div className="grid w-full min-w-0 gap-4">
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {chat.liveMessage}
      </div>

      {chat.usageLimitResetAt && chat.status === "held" ? (
        <div className="inline-flex h-7 max-w-full items-center gap-1 rounded-full bg-muted px-2.5 text-xs font-medium text-muted-foreground">
          Resets {formatDateTime(chat.usageLimitResetAt)}
        </div>
      ) : null}

      <IssueTimeline
        items={timelineItems}
        issuePrompt={issuePrompt}
        attachments={attachments}
        currentUserName={currentUserName}
      />

      <RealtimeConnectionNotice
        status={chat.connectionStatus}
        message={chat.connectionMessage}
      />

      <MessageComposer
        draft={chat.draft}
        draftFiles={chat.draftFiles}
        disabled={chat.isSending}
        invalidSlashCommand={chat.invalidSlashCommand}
        slashCommands={chat.visibleSlashCommands}
        selectedSlashCommandIndex={chat.boundedSlashCommandIndex}
        onDraftChange={chat.handleDraftChange}
        onFilesChange={chat.setDraftFiles}
        onKeyDown={chat.handlePromptKeyDown}
        onSelectSlashCommand={chat.selectSlashCommand}
        onSubmit={chat.handleSubmit}
        agentProvider={agentProvider}
        hasMessages={chat.displayedMessages.length > 0}
        onAgentProviderChange={onAgentProviderChange}
        agentPickerDisabled={isAgentProviderPending}
      />
    </div>
  )
}

function RealtimeConnectionNotice({
  status,
  message,
}: {
  status: RealtimeConnectionStatus
  message: string | null
}) {
  if (!message) {
    return null
  }

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-sm",
        status === "connected"
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      )}
      role={status === "connected" ? "status" : "alert"}
      aria-live="polite"
    >
      {message}
    </div>
  )
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}
