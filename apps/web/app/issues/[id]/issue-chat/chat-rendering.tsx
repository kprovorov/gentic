"use client"

import { IconExternalLink, IconGitPullRequest } from "@tabler/icons-react"

import { cn } from "@gentic/ui/utils"
import type { AgentProvider, IssueStatus } from "@gentic/validators/issues"

import type { IssuePullRequest } from "@/app/queries"

import { IssueChatComposer } from "./composer"
import { formatPullRequestLabel } from "./pull-requests"
import { IssueChatTranscript } from "./transcript"
import type { ChatMessage, RealtimeConnectionStatus } from "./types"
import { useIssueChatState } from "./use-issue-chat-state"

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
  const chat = useIssueChatState({
    issueId,
    agentProvider,
    initialMessages,
    initialStatus,
    initialUsageLimitResetAt,
    initialPrUrl,
    initialPullRequests,
  })

  return (
    <div className="flex flex-col gap-4">
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {chat.liveMessage}
      </div>
      <IssueChatStatusBar
        status={chat.status}
        usageLimitResetAt={chat.usageLimitResetAt}
        prUrl={chat.prUrl}
        pullRequests={chat.displayedPullRequests}
      />

      <IssueChatTranscript
        messages={chat.displayedMessages}
        issueStatus={chat.status}
        isAgentWorkingWithoutMessage={chat.isAgentWorkingWithoutMessage}
        sendTick={chat.sendTick}
        onRetry={chat.retryFailedMessage}
        retryDisabled={chat.isSending}
      />

      <RealtimeConnectionNotice
        status={chat.connectionStatus}
        message={chat.connectionMessage}
      />

      <IssueChatComposer
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

function IssueChatStatusBar({
  status,
  usageLimitResetAt,
  prUrl,
  pullRequests,
}: {
  status: IssueStatus
  usageLimitResetAt: string | null
  prUrl: string | null
  pullRequests: IssuePullRequest[]
}) {
  if (
    !(usageLimitResetAt && status === "held") &&
    !prUrl &&
    pullRequests.length === 0
  ) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {usageLimitResetAt && status === "held" ? (
        <div className="inline-flex h-7 w-fit items-center gap-1 rounded-full bg-muted px-2.5 text-xs font-medium text-muted-foreground">
          Resets {formatDateTime(usageLimitResetAt)}
        </div>
      ) : null}
      {pullRequests.map((pullRequest) => (
        <PullRequestLink key={pullRequest.id} url={pullRequest.url} />
      ))}
      {prUrl && pullRequests.length === 0 ? (
        <PullRequestLink url={prUrl} />
      ) : null}
    </div>
  )
}

function PullRequestLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-7 w-fit items-center gap-1 rounded-full bg-indigo-500/15 px-2.5 text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300"
    >
      <IconGitPullRequest className="size-3.5" />
      {formatPullRequestLabel(url)}
      <IconExternalLink className="size-3.5" />
    </a>
  )
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}
