import assert from "node:assert/strict"
import { test } from "node:test"

import type { IssueEventContract } from "@gentic/validators/realtime"

import type { ChatMessage } from "../issue-chat-state"
import { buildIssueTimeline, type TimelineItem } from "./build-timeline"

const issue = { created_at: "2026-07-01T00:00:00.000Z" }

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "message-1",
    role: "assistant",
    kind: "text",
    content: "hello",
    status: "complete",
    created_at: "2026-07-01T00:05:00.000Z",
    ...overrides,
  }
}

function event(
  overrides: Partial<IssueEventContract> = {}
): IssueEventContract {
  return {
    id: "event-1",
    issue_id: "issue-1",
    type: "status_changed",
    payload: { from: "todo", to: "in-progress" },
    created_at: "2026-07-01T00:10:00.000Z",
    ...overrides,
  }
}

function kinds(items: TimelineItem[]) {
  return items.map((item) => item.kind)
}

test("synthesizes an issue-created node from the issue's created_at", () => {
  const timeline = buildIssueTimeline({ issue, messages: [], events: [] })

  assert.deepEqual(timeline, [
    {
      kind: "issue-created",
      key: "issue-created",
      timestamp: issue.created_at,
    },
  ])
})

test("interleaves messages and events in chronological order regardless of input order", () => {
  const claimedMessage = message({
    id: "msg-claimed",
    role: "system",
    content: "claimed by host",
    created_at: "2026-07-01T00:01:00.000Z",
  })
  const replyMessage = message({
    id: "msg-reply",
    created_at: "2026-07-01T00:15:00.000Z",
  })
  const statusEvent = event({
    id: "evt-status",
    type: "status_changed",
    payload: { from: "todo", to: "in-progress" },
    created_at: "2026-07-01T00:02:00.000Z",
  })
  const prOpenedEvent = event({
    id: "evt-pr-opened",
    type: "pr_opened",
    payload: { pr_url: "https://github.com/acme/repo/pull/1" },
    created_at: "2026-07-01T00:20:00.000Z",
  })

  // Deliberately passed out of chronological order.
  const timeline = buildIssueTimeline({
    issue,
    messages: [replyMessage, claimedMessage],
    events: [prOpenedEvent, statusEvent],
  })

  assert.deepEqual(kinds(timeline), [
    "issue-created",
    "message",
    "status-milestone",
    "message",
    "pr-opened",
  ])
  assert.deepEqual(
    timeline.map((item) => item.timestamp),
    [
      issue.created_at,
      claimedMessage.created_at,
      statusEvent.created_at,
      replyMessage.created_at,
      prOpenedEvent.created_at,
    ]
  )
})

test("uses structured chat event timestamps for message timeline placement", () => {
  const timeline = buildIssueTimeline({
    issue,
    messages: [
      message({
        id: "msg-event-time",
        created_at: "2026-07-01T00:30:00.000Z",
        event_ts: "2026-07-01T00:05:00.000Z",
      }),
    ],
    events: [
      event({
        id: "evt-status",
        created_at: "2026-07-01T00:10:00.000Z",
      }),
    ],
  })

  assert.deepEqual(kinds(timeline), [
    "issue-created",
    "message",
    "status-milestone",
  ])
  assert.equal(timeline[1].timestamp, "2026-07-01T00:05:00.000Z")
})

test("maps status_changed events to status-milestone items with from/to", () => {
  const [, item] = buildIssueTimeline({
    issue,
    messages: [],
    events: [event({ payload: { from: "todo", to: "in-progress" } })],
  })

  assert.deepEqual(item, {
    kind: "status-milestone",
    key: "event-1",
    timestamp: "2026-07-01T00:10:00.000Z",
    from: "todo",
    to: "in-progress",
  })
})

test("maps priority_changed events to priority-milestone items with from/to", () => {
  const [, item] = buildIssueTimeline({
    issue,
    messages: [],
    events: [
      event({
        type: "priority_changed",
        payload: { from: "medium", to: "urgent" },
      }),
    ],
  })

  assert.deepEqual(item, {
    kind: "priority-milestone",
    key: "event-1",
    timestamp: "2026-07-01T00:10:00.000Z",
    from: "medium",
    to: "urgent",
  })
})

test("maps labels_changed events to labels-milestone items with added/removed snapshots", () => {
  const added = [{ id: "label-1", name: "Bug", color: "#FF0000" }]
  const removed = [{ id: "label-2", name: "Feature", color: "#00FF00" }]
  const [, item] = buildIssueTimeline({
    issue,
    messages: [],
    events: [
      event({
        type: "labels_changed",
        payload: { added, removed },
      }),
    ],
  })

  assert.deepEqual(item, {
    kind: "labels-milestone",
    key: "event-1",
    timestamp: "2026-07-01T00:10:00.000Z",
    added,
    removed,
  })
})

test("does not fall back to status-milestone for labels_changed events", () => {
  const [, item] = buildIssueTimeline({
    issue,
    messages: [],
    events: [
      event({
        type: "labels_changed",
        payload: { added: [], removed: [] },
      }),
    ],
  })

  assert.notEqual(item.kind, "status-milestone")
})

test("maps pr_opened events to pr-opened items carrying the PR url", () => {
  const [, item] = buildIssueTimeline({
    issue,
    messages: [],
    events: [
      event({
        type: "pr_opened",
        payload: { pr_url: "https://github.com/acme/repo/pull/1" },
      }),
    ],
  })

  assert.deepEqual(item, {
    kind: "pr-opened",
    key: "event-1",
    timestamp: "2026-07-01T00:10:00.000Z",
    prUrl: "https://github.com/acme/repo/pull/1",
  })
})

test("maps pr_associated events to pr-opened items while retaining pr_opened compatibility", () => {
  const [, item] = buildIssueTimeline({
    issue,
    messages: [],
    events: [
      event({
        type: "pr_associated",
        payload: { pr_url: "https://github.com/acme/repo/pull/2" },
      }),
    ],
  })

  assert.deepEqual(item, {
    kind: "pr-opened",
    key: "event-1",
    timestamp: "2026-07-01T00:10:00.000Z",
    prUrl: "https://github.com/acme/repo/pull/2",
  })
})

test("maps pr_merged events to pr-merged items carrying the PR url", () => {
  const [, item] = buildIssueTimeline({
    issue,
    messages: [],
    events: [
      event({
        type: "pr_merged",
        payload: { pr_url: "https://github.com/acme/repo/pull/1" },
      }),
    ],
  })

  assert.deepEqual(item, {
    kind: "pr-merged",
    key: "event-1",
    timestamp: "2026-07-01T00:10:00.000Z",
    prUrl: "https://github.com/acme/repo/pull/1",
  })
})

test("maps review_queued events to review-queued items with the run id and attempt number", () => {
  const [, item] = buildIssueTimeline({
    issue,
    messages: [],
    events: [
      event({
        type: "review_queued",
        payload: {
          review_cycle_id: "cycle-1",
          review_run_id: "run-1",
          pull_request_id: "pr-1",
          head_sha: "sha-1",
          attempt_number: 2,
        },
      }),
    ],
  })

  assert.deepEqual(item, {
    kind: "review-queued",
    key: "event-1",
    timestamp: "2026-07-01T00:10:00.000Z",
    reviewRunId: "run-1",
    attemptNumber: 2,
  })
})

test("maps review_started events to review-started items with the run id", () => {
  const [, item] = buildIssueTimeline({
    issue,
    messages: [],
    events: [
      event({
        type: "review_started",
        payload: {
          review_run_id: "run-1",
          review_cycle_id: "cycle-1",
          pull_request_id: "pr-1",
        },
      }),
    ],
  })

  assert.deepEqual(item, {
    kind: "review-started",
    key: "event-1",
    timestamp: "2026-07-01T00:10:00.000Z",
    reviewRunId: "run-1",
  })
})

test("maps review_approved events, distinguishing an automatic verdict from a human override", () => {
  const [, item] = buildIssueTimeline({
    issue,
    messages: [],
    events: [
      event({
        type: "review_approved",
        payload: {
          review_attempt_id: "attempt-1",
          review_cycle_id: "cycle-1",
          pull_request_id: "pr-1",
          attempt_number: 1,
          source: "human_override",
        },
      }),
    ],
  })

  assert.deepEqual(item, {
    kind: "review-approved",
    key: "event-1",
    timestamp: "2026-07-01T00:10:00.000Z",
    source: "human_override",
    attemptNumber: 1,
  })
})

test("maps review_changes_requested events with verdict and findings count", () => {
  const [, item] = buildIssueTimeline({
    issue,
    messages: [],
    events: [
      event({
        type: "review_changes_requested",
        payload: {
          review_attempt_id: "attempt-1",
          review_cycle_id: "cycle-1",
          pull_request_id: "pr-1",
          attempt_number: 2,
          verdict: "changes_requested",
          findings_count: 3,
        },
      }),
    ],
  })

  assert.deepEqual(item, {
    kind: "review-changes-requested",
    key: "event-1",
    timestamp: "2026-07-01T00:10:00.000Z",
    verdict: "changes_requested",
    findingsCount: 3,
    attemptNumber: 2,
  })
})

test("maps review_failed events, distinguishing a retried infra failure from a stopped one", () => {
  const [, item] = buildIssueTimeline({
    issue,
    messages: [],
    events: [
      event({
        type: "review_failed",
        payload: {
          review_run_id: "run-1",
          review_cycle_id: "cycle-1",
          pull_request_id: "pr-1",
          error: "boom",
          retried: false,
        },
      }),
    ],
  })

  assert.deepEqual(item, {
    kind: "review-failed",
    key: "event-1",
    timestamp: "2026-07-01T00:10:00.000Z",
    reviewRunId: "run-1",
    retried: false,
  })
})

test("maps review_superseded events with the supersede reason", () => {
  const [, item] = buildIssueTimeline({
    issue,
    messages: [],
    events: [
      event({
        type: "review_superseded",
        payload: {
          review_cycle_id: "cycle-1",
          pull_request_id: "pr-1",
          reason: "human_review",
        },
      }),
    ],
  })

  assert.deepEqual(item, {
    kind: "review-superseded",
    key: "event-1",
    timestamp: "2026-07-01T00:10:00.000Z",
    reason: "human_review",
  })
})

test("maps review_fix_delivered events to a review-fix-delivered item", () => {
  const [, item] = buildIssueTimeline({
    issue,
    messages: [],
    events: [
      event({
        type: "review_fix_delivered",
        payload: { review_attempt_id: "attempt-1", message_id: "message-1" },
      }),
    ],
  })

  assert.deepEqual(item, {
    kind: "review-fix-delivered",
    key: "event-1",
    timestamp: "2026-07-01T00:10:00.000Z",
  })
})

test("maps implementation_ownership_reset events to an implementation-ownership-reset item", () => {
  const [, item] = buildIssueTimeline({
    issue,
    messages: [],
    events: [
      event({
        type: "implementation_ownership_reset",
        payload: { generation: 2, origin: "fresh_implementation" },
      }),
    ],
  })

  assert.deepEqual(item, {
    kind: "implementation-ownership-reset",
    key: "event-1",
    timestamp: "2026-07-01T00:10:00.000Z",
  })
})

test("falls back to a status-milestone for unrecognized event types instead of dropping them", () => {
  const [, item] = buildIssueTimeline({
    issue,
    messages: [],
    events: [event({ type: "something_future", payload: {} })],
  })

  assert.equal(item.kind, "status-milestone")
})

test("treats non-string payload fields as null rather than throwing", () => {
  const [, statusItem] = buildIssueTimeline({
    issue,
    messages: [],
    events: [event({ payload: { from: 1, to: null } })],
  })
  assert.deepEqual(statusItem, {
    kind: "status-milestone",
    key: "event-1",
    timestamp: "2026-07-01T00:10:00.000Z",
    from: null,
    to: null,
  })

  const [, prItem] = buildIssueTimeline({
    issue,
    messages: [],
    events: [event({ type: "pr_opened", payload: {} })],
  })
  assert.deepEqual(prItem, {
    kind: "pr-opened",
    key: "event-1",
    timestamp: "2026-07-01T00:10:00.000Z",
    prUrl: null,
  })
})

test("keeps system lifecycle messages as plain message items instead of reinventing them", () => {
  const claimedMessage = message({
    id: "msg-claimed",
    role: "system",
    content: "claimed by host",
  })

  const timeline = buildIssueTimeline({
    issue,
    messages: [claimedMessage],
    events: [],
  })

  const item = timeline.find((entry) => entry.kind === "message")
  assert.ok(item && item.kind === "message")
  assert.equal(item.message, claimedMessage)
})

test("does not crash when a message or event timestamp is missing or malformed", () => {
  const brokenMessage = message({
    id: "msg-broken",
    created_at: undefined as unknown as string,
  })
  const malformedMessage = message({
    id: "msg-malformed",
    created_at: "not-a-real-timestamp",
  })
  const brokenEvent = event({
    id: "evt-broken",
    created_at: null as unknown as string,
  })

  assert.doesNotThrow(() => {
    buildIssueTimeline({
      issue,
      messages: [brokenMessage, malformedMessage],
      events: [brokenEvent],
    })
  })

  const timeline = buildIssueTimeline({
    issue,
    messages: [brokenMessage, malformedMessage],
    events: [brokenEvent],
  })
  assert.equal(timeline.length, 4)
  // Missing/non-string timestamps sort before valid ISO timestamps.
  assert.deepEqual(kinds(timeline.slice(0, 2)), ["message", "status-milestone"])
})

test("does not crash when the issue itself has a missing created_at", () => {
  assert.doesNotThrow(() => {
    buildIssueTimeline({
      issue: { created_at: undefined as unknown as string },
      messages: [message()],
      events: [event()],
    })
  })
})
