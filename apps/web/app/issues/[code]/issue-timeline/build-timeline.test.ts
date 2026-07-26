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

function event(overrides: Partial<IssueEventContract> = {}): IssueEventContract {
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
    { kind: "issue-created", key: "issue-created", timestamp: issue.created_at },
  ])
})

test("interleaves messages and events in chronological order regardless of input order", () => {
  const claimedMessage = message({
    id: "msg-claimed",
    role: "system",
    content: "claimed by worker",
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
    content: "claimed by worker",
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
