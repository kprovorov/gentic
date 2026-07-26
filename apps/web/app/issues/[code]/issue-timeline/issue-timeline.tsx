"use client"

import { useMemo, useState } from "react"
import {
  IconAlertCircle,
  IconArrowRight,
  IconBulb,
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
  icon: React.ReactNode
  content: React.ReactNode
}

export function IssueTimeline({
  items,
  issuePrompt,
  attachments,
}: {
  items: TimelineItem[]
  issuePrompt: string | null
  attachments: Attachment[]
}) {
  const rows = useMemo(() => {
    const displayItems = groupTimelineItems(items)
    return buildTimelineRows(displayItems, { issuePrompt, attachments })
  }, [items, issuePrompt, attachments])

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>
  }

  return (
    <div className="grid">
      {rows.map((row, index) => (
        <TimelineRow
          key={row.key}
          icon={row.icon}
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
  }: { issuePrompt: string | null; attachments: Attachment[] }
): TimelineRowData[] {
  const rows: TimelineRowData[] = []

  for (const displayItem of displayItems) {
    if (displayItem.kind === "tool-group") {
      rows.push({
        key: displayItem.key,
        icon: <ToolGroupIcon messages={displayItem.messages} />,
        content: <ToolCallGroupContent messages={displayItem.messages} />,
      })
      continue
    }

    if (displayItem.kind === "message") {
      const { message } = displayItem.item
      rows.push({
        key: displayItem.item.key,
        icon: <MessageIcon message={message} />,
        content: <MessageBody message={message} />,
      })
      continue
    }

    const { item } = displayItem
    switch (item.kind) {
      case "issue-created":
        rows.push({
          key: item.key,
          icon: <IconFilePlus />,
          content: "Issue created by you",
        })
        rows.push({
          key: "request",
          icon: <IconFileText />,
          content: (
            <RequestContent prompt={issuePrompt} attachments={attachments} />
          ),
        })
        break
      case "status-milestone":
        rows.push({
          key: item.key,
          icon: <IconArrowRight />,
          content: <StatusMilestoneContent from={item.from} to={item.to} />,
        })
        break
      case "pr-opened":
        rows.push({
          key: item.key,
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
          icon: <IconGitMerge />,
          content: (
            <PullRequestContent
              label="Pull request merged"
              prUrl={item.prUrl}
            />
          ),
        })
        break
    }
  }

  return rows
}

function TimelineRow({
  icon,
  isLast,
  children,
}: {
  icon: React.ReactNode
  isLast: boolean
  children: React.ReactNode
}) {
  return (
    <div className="relative flex items-start gap-3 pb-6 last:pb-0">
      {!isLast ? (
        <span
          aria-hidden="true"
          className="absolute top-8 bottom-[-1.5rem] left-4 w-px -translate-x-1/2 bg-border"
        />
      ) : null}
      <MarkerIcon className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border bg-card text-muted-foreground [&_svg]:size-4">
        {icon}
      </MarkerIcon>
      <MarkerContent className="min-w-0 flex-1 pt-1.5 text-sm">
        {children}
      </MarkerContent>
    </div>
  )
}

function MessageIcon({ message }: { message: ChatMessage }) {
  if (message.kind === "thinking") {
    return <IconBulb />
  }
  if (message.role === "system") {
    return <IconInfoCircle />
  }
  if (message.role === "user") {
    return <IconUserCircle />
  }
  return <IconSparkles />
}

function MessageBody({ message }: { message: ChatMessage }) {
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
    message.status === "error"
      ? "destructive"
      : isUser
        ? "tinted"
        : "secondary"

  return (
    <Bubble align="start" variant={variant} className="max-w-full">
      <BubbleContent className="whitespace-pre-wrap">
        <ChatMarkdown content={content} isStreaming={isStreaming} />
        {isStreaming ? <span className="ml-0.5 animate-pulse">▍</span> : null}
        <AttachmentPreviews attachments={message.attachments} />
      </BubbleContent>
    </Bubble>
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
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
        >
          {isStreaming ? (
            <IconLoader2 className="size-3.5 shrink-0 animate-spin" />
          ) : null}
          Thinking
          <IconChevronDown
            className={cn(
              "size-3.5 shrink-0 transition-transform",
              open && "rotate-180"
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 rounded-lg border border-dashed p-3 whitespace-pre-wrap text-muted-foreground">
          {message.content || "Thinking..."}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function ToolGroupIcon({ messages }: { messages: ChatMessage[] }) {
  const hasError = messages.some((message) => message.status === "error")
  const hasStreaming = messages.some((message) => message.status === "streaming")

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
  const hasStreaming = messages.some((message) => message.status === "streaming")
  const summary =
    messages.length === 1
      ? firstLine(messages[0].content ?? "")
      : `${messages.length} tool calls`

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium",
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
        <div className="mt-2 space-y-2">
          {messages.map((message) => (
            <pre
              key={message.clientKey ?? message.id}
              className="max-h-48 overflow-auto rounded-lg border bg-muted/40 p-2 font-mono text-xs whitespace-pre-wrap break-words text-muted-foreground"
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

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button type="button" className="flex items-center gap-1.5 font-medium">
          Request
          <IconChevronDown
            className={cn(
              "size-3.5 shrink-0 transition-transform",
              open && "rotate-180"
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 grid gap-3">
          <Bubble variant="secondary" align="start" className="max-w-full">
            <BubbleContent className="whitespace-pre-wrap">
              {prompt || "No prompt provided."}
            </BubbleContent>
          </Bubble>
          <AttachmentPreviews attachments={attachments} />
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
