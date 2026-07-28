import type React from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { Attachment } from "../attachments"
import type { ChatMessage } from "../issue-chat-state"
import type { TimelineItem } from "./build-timeline"
import { IssueTimeline } from "./issue-timeline"

vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// attachments.tsx also exports the upload/delete manager, which pulls in
// server actions (and transitively `server-only`); stub it out since this
// suite only exercises the read-only `AttachmentPreviews` list.
vi.mock("@/app/issues/actions", () => ({
  deleteAttachment: vi.fn(),
  uploadAttachments: vi.fn(),
}))

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

function messageItem(overrides: Partial<ChatMessage> = {}): TimelineItem {
  const msg = message(overrides)
  return {
    kind: "message",
    key: msg.clientKey ?? msg.id,
    timestamp: msg.created_at,
    message: msg,
  }
}

const attachment: Attachment = {
  id: "attachment-1",
  fileName: "screenshot.png",
  sizeBytes: 1024,
  url: "https://files.example.com/screenshot.png",
  thumbnailUrl: null,
}

describe("IssueTimeline", () => {
  it("renders an expanded request node with the prompt and attachments", () => {
    render(
      <IssueTimeline
        items={[
          {
            kind: "issue-created",
            key: "issue-created",
            timestamp: "2026-07-01T00:00:00.000Z",
          },
        ]}
        issuePrompt="Fix the flaky test"
        attachments={[attachment]}
      />
    )

    expect(screen.getByText("Issue created by you")).toBeInTheDocument()
    expect(screen.getByText("Request")).toBeInTheDocument()
    expect(screen.getByText("Fix the flaky test")).toBeInTheDocument()
    expect(screen.getByText("screenshot.png")).toBeInTheDocument()
  })

  it("collapses and expands the request node on toggle", async () => {
    const user = userEvent.setup()
    render(
      <IssueTimeline
        items={[
          {
            kind: "issue-created",
            key: "issue-created",
            timestamp: "2026-07-01T00:00:00.000Z",
          },
        ]}
        issuePrompt={"Fix the flaky test\nIt fails intermittently in CI."}
        attachments={[]}
      />
    )

    expect(
      screen.getByText("It fails intermittently in CI.", { exact: false })
    ).toBeVisible()
    await user.click(screen.getByRole("button", { name: /Request/ }))
    expect(
      screen.queryByText("It fails intermittently in CI.", { exact: false })
    ).not.toBeInTheDocument()
  })

  it("uses the first matching user message as the original request", () => {
    render(
      <IssueTimeline
        items={[
          {
            kind: "issue-created",
            key: "issue-created",
            timestamp: "2026-07-01T00:00:00.000Z",
          },
          messageItem({
            id: "user-1",
            role: "user",
            content: "Fix the flaky test",
          }),
        ]}
        issuePrompt="Fix the flaky test"
        attachments={[]}
      />
    )

    expect(screen.getByText("Original request")).toBeInTheDocument()
    expect(screen.queryByText("Request")).not.toBeInTheDocument()
    expect(screen.getAllByText("Fix the flaky test")).toHaveLength(1)
  })

  it("uses the first user message as the original request when the prompt is empty", () => {
    render(
      <IssueTimeline
        items={[
          {
            kind: "issue-created",
            key: "issue-created",
            timestamp: "2026-07-01T00:00:00.000Z",
          },
          messageItem({
            id: "user-1",
            role: "user",
            content: "Fix the flaky test",
            attachments: [attachment],
          }),
        ]}
        issuePrompt={null}
        attachments={[attachment]}
      />
    )

    expect(screen.getByText("Original request")).toBeInTheDocument()
    expect(screen.queryByText("Request")).not.toBeInTheDocument()
    expect(screen.getByText("screenshot.png")).toBeInTheDocument()
    expect(screen.getAllByText("Fix the flaky test")).toHaveLength(1)
  })

  it("keeps request attachments when there is no user message yet", () => {
    render(
      <IssueTimeline
        items={[
          {
            kind: "issue-created",
            key: "issue-created",
            timestamp: "2026-07-01T00:00:00.000Z",
          },
        ]}
        issuePrompt={null}
        attachments={[attachment]}
      />
    )

    expect(screen.getByText("Request")).toBeInTheDocument()
    expect(screen.getByText("No prompt provided.")).toBeInTheDocument()
    expect(screen.getByText("screenshot.png")).toBeInTheDocument()
  })

  it("renders a status milestone with from and to badges", () => {
    render(
      <IssueTimeline
        items={[
          {
            kind: "status-milestone",
            key: "evt-1",
            timestamp: "2026-07-01T00:00:00.000Z",
            from: "testing",
            to: "ready-for-review",
          },
        ]}
        issuePrompt={null}
        attachments={[]}
      />
    )

    expect(screen.getByText("Testing")).toBeInTheDocument()
    expect(screen.getByText("Ready for review")).toBeInTheDocument()
  })

  it("groups adjacent tool calls into a single collapsible pill", async () => {
    const user = userEvent.setup()
    render(
      <IssueTimeline
        items={[
          messageItem({
            id: "tool-a",
            kind: "tool",
            content: "Reading file A",
          }),
          messageItem({
            id: "tool-b",
            kind: "tool",
            content: "Editing file B",
          }),
        ]}
        issuePrompt={null}
        attachments={[]}
      />
    )

    expect(screen.getByText("2 tool calls")).toBeInTheDocument()
    expect(screen.queryByText("Reading file A")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "2 tool calls" }))
    expect(screen.getByText("Reading file A")).toBeVisible()
    expect(screen.getByText("Editing file B")).toBeVisible()
  })

  it("renders thinking as a collapsible block, collapsed by default", async () => {
    const user = userEvent.setup()
    render(
      <IssueTimeline
        items={[
          messageItem({
            id: "thought-1",
            kind: "thinking",
            content: "Considering approach",
          }),
        ]}
        issuePrompt={null}
        attachments={[]}
      />
    )

    expect(screen.getByText("Thinking")).toBeInTheDocument()
    expect(screen.queryByText("Considering approach")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: /Thinking/ }))
    expect(screen.getByText("Considering approach")).toBeVisible()
  })

  it("renders user and assistant chat bubbles", () => {
    render(
      <IssueTimeline
        items={[
          messageItem({
            id: "user-1",
            role: "user",
            content: "Please fix this",
          }),
          messageItem({
            id: "assistant-1",
            role: "assistant",
            content: "On it",
          }),
        ]}
        issuePrompt={null}
        attachments={[]}
      />
    )

    expect(screen.getByText("Please fix this")).toBeInTheDocument()
    expect(screen.getByText("On it")).toBeInTheDocument()
  })

  it("renders timestamps for messages and activity events", () => {
    const { container } = render(
      <IssueTimeline
        items={[
          {
            kind: "status-milestone",
            key: "evt-1",
            timestamp: "2026-07-01T00:00:00.000Z",
            from: "todo",
            to: "in-progress",
          },
          messageItem({
            id: "assistant-1",
            content: "On it",
            created_at: "2026-07-01T00:05:00.000Z",
          }),
        ]}
        issuePrompt={null}
        attachments={[]}
      />
    )

    expect(
      container.querySelector('time[datetime="2026-07-01T00:00:00.000Z"]')
    ).toBeInTheDocument()
    expect(
      container.querySelector('time[datetime="2026-07-01T00:05:00.000Z"]')
    ).toBeInTheDocument()
  })

  it("renders pr-opened and pr-merged nodes with links", () => {
    render(
      <IssueTimeline
        items={[
          {
            kind: "pr-opened",
            key: "evt-open",
            timestamp: "2026-07-01T00:00:00.000Z",
            prUrl: "https://github.com/acme/repo/pull/42",
          },
          {
            kind: "pr-merged",
            key: "evt-merge",
            timestamp: "2026-07-01T00:10:00.000Z",
            prUrl: "https://github.com/acme/repo/pull/42",
          },
        ]}
        issuePrompt={null}
        attachments={[]}
      />
    )

    expect(screen.getByText(/Pull request opened/)).toBeInTheDocument()
    expect(screen.getByText(/Pull request merged/)).toBeInTheDocument()
    const links = screen.getAllByRole("link", { name: "acme/repo#42" })
    expect(links).toHaveLength(2)
  })

  it("renders a fallback when there is no timeline activity", () => {
    render(<IssueTimeline items={[]} issuePrompt={null} attachments={[]} />)

    expect(screen.getByText("No activity yet.")).toBeInTheDocument()
  })
})
