import type { IssueEventContract } from "@gentic/validators/realtime"

import type { ChatMessage } from "../issue-chat-state"

export type TimelineItem =
  | { kind: "issue-created"; key: string; timestamp: string }
  | { kind: "message"; key: string; timestamp: string; message: ChatMessage }
  | {
      kind: "status-milestone"
      key: string
      timestamp: string
      from: string | null
      to: string | null
    }
  | { kind: "pr-opened"; key: string; timestamp: string; prUrl: string | null }
  | { kind: "pr-merged"; key: string; timestamp: string; prUrl: string | null }

export function buildIssueTimeline({
  issue,
  messages,
  events,
}: {
  issue: { created_at: string }
  messages: ChatMessage[]
  events: IssueEventContract[]
}): TimelineItem[] {
  const items: TimelineItem[] = [
    {
      kind: "issue-created",
      key: "issue-created",
      timestamp: issue.created_at,
    },
    ...messages.map(messageToTimelineItem),
    ...events.map(eventToTimelineItem),
  ]

  return items.sort((a, b) =>
    timestampSortKey(a.timestamp).localeCompare(timestampSortKey(b.timestamp))
  )
}

function messageToTimelineItem(message: ChatMessage): TimelineItem {
  return {
    kind: "message",
    key: message.clientKey ?? message.id,
    timestamp: message.event_ts ?? message.created_at,
    message,
  }
}

function eventToTimelineItem(event: IssueEventContract): TimelineItem {
  const key = event.id
  const timestamp = event.created_at

  switch (event.type) {
    case "pr_opened":
      return {
        kind: "pr-opened",
        key,
        timestamp,
        prUrl: readStringField(event.payload, "pr_url"),
      }
    case "pr_merged":
      return {
        kind: "pr-merged",
        key,
        timestamp,
        prUrl: readStringField(event.payload, "pr_url"),
      }
    // `status_changed` is the default for any unrecognized future event
    // type too, so the timeline degrades gracefully instead of dropping it.
    case "status_changed":
    default:
      return {
        kind: "status-milestone",
        key,
        timestamp,
        from: readStringField(event.payload, "from"),
        to: readStringField(event.payload, "to"),
      }
  }
}

function readStringField(
  payload: Record<string, unknown>,
  key: string
): string | null {
  const value = payload[key]
  return typeof value === "string" ? value : null
}

// Timestamps are compared as strings (ISO 8601 sorts lexicographically), the
// same convention `issueChatReducer` uses. Missing/non-string values sort
// first rather than throwing, since malformed historical data shouldn't
// crash the timeline.
function timestampSortKey(timestamp: unknown): string {
  return typeof timestamp === "string" ? timestamp : ""
}
