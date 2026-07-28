"use client"

import { useMemo, useState } from "react"
import {
  IconAlertCircle,
  IconArrowRight,
  IconBrain,
  IconCheck,
  IconChevronDown,
  IconFilePlus,
  IconFileText,
  IconGitMerge,
  IconGitPullRequest,
  IconInfoCircle,
  IconLoader2,
  IconSparkles,
  IconTool,
  IconUserCircle,
} from "@tabler/icons-react"

import { AttachmentPreviews, type Attachment } from "../attachments"
import { ChatMarkdown } from "../issue-chat/chat-markdown"
import type { ChatMessage } from "../issue-chat-state"
import { firstLine } from "../issue-chat/transcript-items"
import { statusIcons, statusLabels, statusStyles } from "../issue-status-meta"
import { Bubble, BubbleContent } from "@gentic/ui/bubble"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@gentic/ui/collapsible"
import { MarkerContent, MarkerIcon } from "@gentic/ui/marker"
import { cn } from "@gentic/ui/utils"
import type { IssueStatus } from "@gentic/validators/issues"

import type { TimelineItem } from "./build-timeline"
import { groupTimelineItems, type TimelineDisplayItem } from "./timeline-items"

type TimelineRowData = {
  key: string
  timestamp: string
  icon: React.ReactNode
  content: React.ReactNode
  markerClassName?: string
}

const MARKER_TINTS = {
  streaming: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  error: "bg-destructive/15 text-destructive",
  success: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  user: "bg-primary/20 text-primary",
}

export function IssueTimeline({
  items,
  issuePrompt,
  attachments,
  currentUserName,
}: {
  items: TimelineItem[]
  issuePrompt: string | null
  attachments: Attachment[]
  currentUserName?: string | null
}) {
  const rows = useMemo(() => {
    const displayItems = groupTimelineItems(items)
    return buildTimelineRows(displayItems, {
      issuePrompt,
      attachments,
      currentUserName,
    })
  }, [items, issuePrompt, attachments, currentUserName])

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>
  }

  return (
    <div className="grid min-w-0">
      {rows.map((row, index) => (
        <TimelineRow
          key={row.key}
          icon={row.icon}
          timestamp={row.timestamp}
          markerClassName={row.markerClassName}
          isLast={index === rows.length - 1}
        >
          {row.content}
        </TimelineRow>
      ))}
    </div>
  )
}

function buildTimelineRows(
  displayItems: TimelineDisplayItem[],
  {
    issuePrompt,
    attachments,
    currentUserName,
  }: {
    issuePrompt: string | null
    attachments: Attachment[]
    currentUserName?: string | null
  }
): TimelineRowData[] {
  const rows: TimelineRowData[] = []
  const originalRequestMessageKey = findOriginalRequestMessageKey(
    displayItems,
    issuePrompt
  )
  const shouldShowRequestPrompt = originalRequestMessageKey === null

  for (const displayItem of displayItems) {
    if (displayItem.kind === "tool-group") {
      const hasError = displayItem.messages.some(
        (message) => message.status === "error"
      )
      const hasStreaming = displayItem.messages.some(
        (message) => message.status === "streaming"
      )
      rows.push({
        key: displayItem.key,
        timestamp: displayItem.timestamp,
        icon: <ToolGroupIcon messages={displayItem.messages} />,
        content: <ToolCallGroupContent messages={displayItem.messages} />,
        markerClassName: hasStreaming
          ? MARKER_TINTS.streaming
          : hasError
            ? MARKER_TINTS.error
            : MARKER_TINTS.success,
      })
      continue
    }

    if (displayItem.kind === "message") {
      const { message } = displayItem.item
      rows.push({
        key: displayItem.item.key,
        timestamp: displayItem.item.timestamp,
        icon: (
          <MessageIcon message={message} currentUserName={currentUserName} />
        ),
        content: (
          <MessageBody
            message={message}
            isOriginalRequest={
              displayItem.item.key === originalRequestMessageKey
            }
          />
        ),
        markerClassName: messageMarkerClassName(message),
      })
      continue
    }

    const { item } = displayItem
    switch (item.kind) {
      case "issue-created":
        rows.push({
          key: item.key,
          timestamp: item.timestamp,
          icon: <IconFilePlus />,
          content: "Issue created by you",
        })
        if (shouldShowRequestPrompt) {
          rows.push({
            key: "request",
            timestamp: item.timestamp,
            icon: <IconFileText />,
            content: (
              <RequestContent
                prompt={shouldShowRequestPrompt ? issuePrompt : null}
                attachments={attachments}
              />
            ),
          })
        }
        break
      case "status-milestone": {
        const milestoneStatus = item.to ?? item.from
        const isKnownStatus =
          milestoneStatus !== null && milestoneStatus in statusStyles
        rows.push({
          key: item.key,
          timestamp: item.timestamp,
          icon: <IconArrowRight />,
          content: <StatusMilestoneContent from={item.from} to={item.to} />,
          markerClassName: isKnownStatus
            ? statusStyles[milestoneStatus as IssueStatus]
            : undefined,
        })
        break
      }
      case "pr-opened":
        rows.push({
          key: item.key,
          timestamp: item.timestamp,
          icon: <IconGitPullRequest />,
          content: (
            <PullRequestContent
              label="Pull request opened"
              prUrl={item.prUrl}
            />
          ),
        })
        break
      case "pr-merged":
        rows.push({
          key: item.key,
          timestamp: item.timestamp,
          icon: <IconGitMerge />,
          content: (
            <PullRequestContent
              label="Pull request merged"
              prUrl={item.prUrl}
            />
          ),
          markerClassName: statusStyles.merged,
        })
        break
    }
  }

  return rows
}

function findOriginalRequestMessageKey(
  displayItems: TimelineDisplayItem[],
  issuePrompt: string | null
): string | null {
  const normalizedPrompt = normalizeRequestText(issuePrompt)

  const firstUserMessage = displayItems.find(
    (displayItem) =>
      displayItem.kind === "message" && displayItem.item.message.role === "user"
  )

  if (firstUserMessage?.kind !== "message") {
    return null
  }

  if (!normalizedPrompt) {
    return firstUserMessage.item.key
  }

  if (
    normalizeRequestText(firstUserMessage.item.message.content) ===
    normalizedPrompt
  ) {
    return firstUserMessage.item.key
  }

  return null
}

function normalizeRequestText(value: string | null | undefined): string {
  return (value ?? "").trim()
}

function TimelineRow({
  icon,
  timestamp,
  markerClassName,
  isLast,
  children,
}: {
  icon: React.ReactNode
  timestamp: string
  markerClassName?: string
  isLast: boolean
  children: React.ReactNode
}) {
  const formattedTimestamp = formatTimelineTimestamp(timestamp)

  return (
    <div className="flex min-w-0 items-stretch gap-3.5">
      <div className="flex w-[22px] shrink-0 flex-col items-center">
        <MarkerIcon
          className={cn(
            "flex size-[22px] shrink-0 items-center justify-center rounded-full text-muted-foreground [&_svg]:size-3",
            markerClassName ?? "bg-muted"
          )}
        >
          {icon}
        </MarkerIcon>
        {!isLast ? <div className="mt-1 w-px flex-1 bg-border" /> : null}
      </div>
      <MarkerContent className="min-w-0 flex-1 pb-[18px] text-[12.5px]">
        <div className="flex min-w-0 flex-col gap-1.5">
          {formattedTimestamp ? (
            <time
              dateTime={timestamp}
              title={timestamp}
              className="text-[11px] leading-none font-medium text-muted-foreground"
            >
              {formattedTimestamp}
            </time>
          ) : null}
          {children}
        </div>
      </MarkerContent>
    </div>
  )
}

function formatTimelineTimestamp(value: string): string | null {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

function messageMarkerClassName(message: ChatMessage): string | undefined {
  if (message.role === "user") {
    return MARKER_TINTS.user
  }
  if (message.role === "assistant" && message.status === "streaming") {
    return MARKER_TINTS.streaming
  }
  if (message.status === "error") {
    return MARKER_TINTS.error
  }
  return undefined
}

function getInitials(name: string | null | undefined): string | null {
  if (!name) {
    return null
  }
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
  return initials || null
}

function MessageIcon({
  message,
  currentUserName,
}: {
  message: ChatMessage
  currentUserName?: string | null
}) {
  if (message.kind === "thinking") {
    return <IconBrain />
  }
  if (message.role === "system") {
    return <IconInfoCircle />
  }
  if (message.role === "user") {
    const initials = getInitials(currentUserName)
    if (initials) {
      return <span className="text-[10px] font-semibold">{initials}</span>
    }
    return <IconUserCircle />
  }
  if (message.status === "streaming") {
    return <IconLoader2 className="animate-spin" />
  }
  return <IconSparkles />
}

function MessageBody({
  message,
  isOriginalRequest = false,
}: {
  message: ChatMessage
  isOriginalRequest?: boolean
}) {
  const isStreaming = message.status === "streaming"
  const content = message.content ?? ""

  if (message.kind === "thinking") {
    return <ThinkingContent message={message} />
  }

  if (message.role === "system") {
    return (
      <span className="text-muted-foreground">
        {content ? (
          <ChatMarkdown content={content} isStreaming={isStreaming} />
        ) : null}
      </span>
    )
  }

  const isUser = message.role === "user"
  const variant =
    message.status === "error" ? "destructive" : isUser ? "tinted" : "secondary"

  return (
    <div className="min-w-0">
      {isOriginalRequest ? (
        <div className="mb-2 text-[11px] font-semibold tracking-[.08em] text-muted-foreground uppercase">
          Original request
        </div>
      ) : null}
      <Bubble align="start" variant={variant} className="w-full max-w-full">
        <BubbleContent className="w-full whitespace-pre-wrap">
          <ChatMarkdown content={content} isStreaming={isStreaming} />
          {isStreaming ? <span className="ml-0.5 animate-pulse">▍</span> : null}
          <AttachmentPreviews attachments={message.attachments} />
        </BubbleContent>
      </Bubble>
    </div>
  )
}

function ThinkingContent({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false)
  const isStreaming = message.status === "streaming"

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-1.5 text-[11px] font-semibold tracking-[.06em] text-muted-foreground uppercase"
        >
          {isStreaming ? (
            <IconLoader2 className="size-3.5 shrink-0 animate-spin" />
          ) : (
            <IconBrain className="size-3.5 shrink-0" />
          )}
          Thinking
          <span className="flex-1" />
          <IconChevronDown
            className={cn(
              "size-3.5 shrink-0 normal-case transition-transform",
              open && "rotate-180"
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 max-w-full overflow-x-auto rounded-lg border border-dashed p-3 text-[13px] whitespace-pre-wrap text-muted-foreground italic">
          {message.content || "Thinking..."}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function ToolGroupIcon({ messages }: { messages: ChatMessage[] }) {
  const hasError = messages.some((message) => message.status === "error")
  const hasStreaming = messages.some(
    (message) => message.status === "streaming"
  )

  if (hasStreaming) {
    return <IconLoader2 className="animate-spin" />
  }
  if (hasError) {
    return <IconAlertCircle />
  }
  return <IconTool />
}

function ToolCallGroupContent({ messages }: { messages: ChatMessage[] }) {
  const [open, setOpen] = useState(false)
  const hasError = messages.some((message) => message.status === "error")
  const hasStreaming = messages.some(
    (message) => message.status === "streaming"
  )
  const summary =
    messages.length === 1
      ? firstLine(messages[0].content ?? "")
      : `${messages.length} tool calls`

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="min-w-0">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex max-w-full min-w-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium",
            hasError
              ? "border-destructive/40 text-destructive"
              : "text-muted-foreground"
          )}
        >
          {hasStreaming ? (
            <IconLoader2 className="size-3.5 shrink-0 animate-spin" />
          ) : hasError ? (
            <IconAlertCircle className="size-3.5 shrink-0" />
          ) : (
            <IconCheck className="size-3.5 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">
            {summary || "Tool call"}
          </span>
          <IconChevronDown
            className={cn(
              "size-3.5 shrink-0 transition-transform",
              open && "rotate-180"
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 min-w-0 space-y-2">
          {messages.map((message) => (
            <pre
              key={message.clientKey ?? message.id}
              className={cn(
                "max-h-48 max-w-full overflow-auto rounded-lg border p-2 font-mono text-xs break-words whitespace-pre-wrap",
                message.status === "error"
                  ? "border-destructive/40 bg-destructive/5 text-destructive"
                  : "bg-muted/40 text-muted-foreground"
              )}
            >
              {message.content || "Tool call"}
            </pre>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function RequestContent({
  prompt,
  attachments,
}: {
  prompt: string | null
  attachments: Attachment[]
}) {
  const [open, setOpen] = useState(true)
  const hint = open
    ? attachments.length > 0
      ? `${attachments.length} attachment${attachments.length === 1 ? "" : "s"}`
      : null
    : firstLine(prompt ?? "")

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="min-w-0">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full min-w-0 items-center gap-2"
        >
          <span className="text-[11px] font-semibold tracking-[.08em] text-muted-foreground uppercase">
            Request
          </span>
          {hint ? (
            <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">
              {hint}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <IconChevronDown
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180"
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 min-w-0 rounded-[20px] bg-muted/40 p-4">
          <p className="text-sm leading-6 whitespace-pre-wrap">
            {prompt || "No prompt provided."}
          </p>
          {attachments.length > 0 ? (
            <div className="mt-3.5 border-t pt-3">
              <AttachmentPreviews attachments={attachments} />
            </div>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function StatusMilestoneContent({
  from,
  to,
}: {
  from: string | null
  to: string | null
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {from ? (
        <>
          <StatusBadge status={from} />
          <IconArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
        </>
      ) : null}
      <StatusBadge status={to} />
    </div>
  )
}

function StatusBadge({ status }: { status: string | null }) {
  const isKnownStatus = status !== null && status in statusLabels
  if (!isKnownStatus) {
    return (
      <span className="inline-flex h-6 items-center rounded-full bg-muted px-2 text-xs font-medium text-muted-foreground">
        {status ?? "Unknown"}
      </span>
    )
  }

  const knownStatus = status as IssueStatus
  const StatusIcon = statusIcons[knownStatus]

  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium",
        statusStyles[knownStatus]
      )}
    >
      <StatusIcon className="size-3.5" />
      {statusLabels[knownStatus]}
    </span>
  )
}

function PullRequestContent({
  label,
  prUrl,
}: {
  label: string
  prUrl: string | null
}) {
  return (
    <p>
      {label}
      {prUrl ? (
        <>
          {" — "}
          <a
            href={prUrl}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            {formatPullRequestLabel(prUrl)}
          </a>
        </>
      ) : null}
    </p>
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
