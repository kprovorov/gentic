import type {
  IssueEventContract,
  LabelSnapshot,
} from "@gentic/validators/realtime"

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
  | {
      kind: "priority-milestone"
      key: string
      timestamp: string
      from: string | null
      to: string | null
    }
  | {
      kind: "labels-milestone"
      key: string
      timestamp: string
      added: LabelSnapshot[]
      removed: LabelSnapshot[]
    }
  | { kind: "pr-opened"; key: string; timestamp: string; prUrl: string | null }
  | { kind: "pr-merged"; key: string; timestamp: string; prUrl: string | null }
  // Automatic Review lifecycle milestones (GEN-419). Deliberately carry only
  // `reviewRunId` (for the "View logs" trigger) and small display fields —
  // never the reviewer's execution log itself, which stays out of Issue
  // chat/timeline data and is fetched on demand (see `use-review-run-logs`).
  | {
      kind: "review-queued"
      key: string
      timestamp: string
      reviewRunId: string | null
      attemptNumber: number | null
    }
  | {
      kind: "review-started"
      key: string
      timestamp: string
      reviewRunId: string | null
    }
  | {
      kind: "review-approved"
      key: string
      timestamp: string
      source: string | null
      attemptNumber: number | null
    }
  | {
      kind: "review-changes-requested"
      key: string
      timestamp: string
      verdict: string | null
      findingsCount: number | null
      attemptNumber: number | null
    }
  | {
      kind: "review-failed"
      key: string
      timestamp: string
      reviewRunId: string | null
      retried: boolean | null
    }
  | {
      kind: "review-superseded"
      key: string
      timestamp: string
      reason: string | null
    }
  | { kind: "review-fix-delivered"; key: string; timestamp: string }
  | { kind: "implementation-ownership-reset"; key: string; timestamp: string }

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
    case "pr_associated":
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
    case "priority_changed":
      return {
        kind: "priority-milestone",
        key,
        timestamp,
        from: readStringField(event.payload, "from"),
        to: readStringField(event.payload, "to"),
      }
    case "labels_changed":
      return {
        kind: "labels-milestone",
        key,
        timestamp,
        added: readLabelSnapshotArrayField(event.payload, "added"),
        removed: readLabelSnapshotArrayField(event.payload, "removed"),
      }
    case "review_queued":
      return {
        kind: "review-queued",
        key,
        timestamp,
        reviewRunId: readStringField(event.payload, "review_run_id"),
        attemptNumber: readNumberField(event.payload, "attempt_number"),
      }
    case "review_started":
      return {
        kind: "review-started",
        key,
        timestamp,
        reviewRunId: readStringField(event.payload, "review_run_id"),
      }
    case "review_approved":
      return {
        kind: "review-approved",
        key,
        timestamp,
        source: readStringField(event.payload, "source"),
        attemptNumber: readNumberField(event.payload, "attempt_number"),
      }
    case "review_changes_requested":
      return {
        kind: "review-changes-requested",
        key,
        timestamp,
        verdict: readStringField(event.payload, "verdict"),
        findingsCount: readNumberField(event.payload, "findings_count"),
        attemptNumber: readNumberField(event.payload, "attempt_number"),
      }
    case "review_failed":
      return {
        kind: "review-failed",
        key,
        timestamp,
        reviewRunId: readStringField(event.payload, "review_run_id"),
        retried: readBooleanField(event.payload, "retried"),
      }
    case "review_superseded":
      return {
        kind: "review-superseded",
        key,
        timestamp,
        reason: readStringField(event.payload, "reason"),
      }
    case "review_fix_delivered":
      return { kind: "review-fix-delivered", key, timestamp }
    case "implementation_ownership_reset":
      return { kind: "implementation-ownership-reset", key, timestamp }
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

function readNumberField(
  payload: Record<string, unknown>,
  key: string
): number | null {
  const value = payload[key]
  return typeof value === "number" ? value : null
}

function readBooleanField(
  payload: Record<string, unknown>,
  key: string
): boolean | null {
  const value = payload[key]
  return typeof value === "boolean" ? value : null
}

function readLabelSnapshotArrayField(
  payload: Record<string, unknown>,
  key: string
): LabelSnapshot[] {
  const value = payload[key]
  return Array.isArray(value) ? (value as LabelSnapshot[]) : []
}

// Timestamps are compared as strings (ISO 8601 sorts lexicographically), the
// same convention `issueChatReducer` uses. Missing/non-string values sort
// first rather than throwing, since malformed historical data shouldn't
// crash the timeline.
function timestampSortKey(timestamp: unknown): string {
  return typeof timestamp === "string" ? timestamp : ""
}
