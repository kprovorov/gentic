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
  it("renders an expanded request node with the body and attachments", () => {
    render(
      <IssueTimeline
        items={[
          {
            kind: "issue-created",
            key: "issue-created",
            timestamp: "2026-07-01T00:00:00.000Z",
          },
        ]}
        issueBody="Fix the flaky test"
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
        issueBody={"Fix the flaky test\nIt fails intermittently in CI."}
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
        issueBody="Fix the flaky test"
        attachments={[]}
      />
    )

    expect(screen.getByText("Original request")).toBeInTheDocument()
    expect(screen.queryByText("Request")).not.toBeInTheDocument()
    expect(screen.getAllByText("Fix the flaky test")).toHaveLength(1)
  })

  it("renders the current user's avatar for user messages when available", () => {
    const { container } = render(
      <IssueTimeline
        items={[
          messageItem({
            id: "user-1",
            role: "user",
            content: "Fix the flaky test",
          }),
        ]}
        issueBody={null}
        attachments={[]}
        currentUserName="Kai Example"
        currentUserImageUrl="https://img.clerk.com/avatar.png"
      />
    )

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://img.clerk.com/avatar.png"
    )
    expect(screen.queryByText("KE")).not.toBeInTheDocument()
  })

  it("renders Gentic attribution for Gentic-authored user-role messages", () => {
    const { container } = render(
      <IssueTimeline
        items={[
          messageItem({
            id: "auto-1",
            role: "user",
            content: "GitHub tests failed.",
            author_type: "gentic",
          }),
        ]}
        issueBody={null}
        attachments={[]}
        currentUserName="Kai Example"
        currentUserImageUrl="https://img.clerk.com/avatar.png"
      />
    )

    expect(screen.getByText("Gentic")).toBeInTheDocument()
    expect(screen.getByText("GitHub tests failed.")).toBeInTheDocument()
    expect(container.querySelector("img")).not.toBeInTheDocument()
    expect(container.querySelector("svg")).toBeInTheDocument()
  })

  it("keeps legacy user messages on the authenticated user's avatar treatment", () => {
    const { container } = render(
      <IssueTimeline
        items={[
          messageItem({
            id: "legacy-user",
            role: "user",
            content: "Manual follow-up",
          }),
        ]}
        issueBody={null}
        attachments={[]}
        currentUserName="Kai Example"
        currentUserImageUrl="https://img.clerk.com/avatar.png"
      />
    )

    expect(screen.queryByText("Gentic")).not.toBeInTheDocument()
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://img.clerk.com/avatar.png"
    )
  })

  it("renders manual create PR prompts with the current user's avatar", () => {
    const { container } = render(
      <IssueTimeline
        items={[
          messageItem({
            id: "manual-create-pr",
            role: "user",
            content: "The requested work is finished. Publish it now.",
            author_type: "user",
            generated_action: "create_pr",
          }),
        ]}
        issueBody={null}
        attachments={[]}
        currentUserName="Kai Example"
        currentUserImageUrl="https://img.clerk.com/avatar.png"
      />
    )

    expect(screen.queryByText("Gentic")).not.toBeInTheDocument()
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://img.clerk.com/avatar.png"
    )
  })

  it("uses the first user message as the original request when the body is empty", () => {
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
        issueBody={null}
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
        issueBody={null}
        attachments={[attachment]}
      />
    )

    expect(screen.getByText("Request")).toBeInTheDocument()
    expect(screen.getByText("No body provided.")).toBeInTheDocument()
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
        issueBody={null}
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
        issueBody={null}
        attachments={[]}
      />
    )

    expect(screen.getByText("2 tool calls")).toBeInTheDocument()
    expect(screen.queryByText("Reading file A")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "2 tool calls" }))
    expect(screen.getByText("Reading file A")).toBeVisible()
    expect(screen.getByText("Editing file B")).toBeVisible()
  })

  it("renders a diff-shaped tool call with the diff viewer, not raw text", async () => {
    const user = userEvent.setup()
    render(
      <IssueTimeline
        items={[
          messageItem({
            id: "tool-diff",
            kind: "tool",
            content: "Completed: Edit file\nDiff: src/index.ts",
            payload: {
              content: [
                {
                  type: "diff",
                  path: "src/index.ts",
                  oldText: "const a = 1\n",
                  newText: "const a = 2\n",
                },
              ],
            },
          }),
        ]}
        issueBody={null}
        attachments={[]}
      />
    )

    await user.click(screen.getByRole("button", { name: "Completed: Edit file" }))
    expect(screen.getAllByText("Completed: Edit file")[1]).toBeVisible()
    expect(screen.queryByText("Diff: src/index.ts")).not.toBeInTheDocument()
    expect(document.querySelector("diffs-container")).not.toBeNull()
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
        issueBody={null}
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
        issueBody={null}
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
        issueBody={null}
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

  it("renders priority changes with from and to labels", () => {
    render(
      <IssueTimeline
        items={[
          {
            kind: "priority-milestone",
            key: "evt-priority",
            timestamp: "2026-07-01T00:00:00.000Z",
            from: "medium",
            to: "urgent",
          },
        ]}
        issueBody={null}
        attachments={[]}
      />
    )

    expect(screen.getByText("Medium")).toBeInTheDocument()
    expect(screen.getByText("Urgent")).toBeInTheDocument()
  })

  it("renders added and removed label chips for a labels milestone", () => {
    render(
      <IssueTimeline
        items={[
          {
            kind: "labels-milestone",
            key: "evt-labels",
            timestamp: "2026-07-01T00:00:00.000Z",
            added: [{ id: "label-1", name: "Bug", color: "#FF0000" }],
            removed: [{ id: "label-2", name: "Feature", color: "#00FF00" }],
          },
        ]}
        issueBody={null}
        attachments={[]}
      />
    )

    expect(screen.getByText("Added")).toBeInTheDocument()
    expect(screen.getByText("Bug")).toBeInTheDocument()
    expect(screen.getByText("Removed")).toBeInTheDocument()
    expect(screen.getByText("Feature")).toBeInTheDocument()
  })

  it("keeps archived label references readable but grays and strikes them through", () => {
    render(
      <IssueTimeline
        items={[
          {
            kind: "labels-milestone",
            key: "evt-labels-archived",
            timestamp: "2026-07-01T00:00:00.000Z",
            added: [
              { id: "label-archived", name: "Retired", color: "#FF0000" },
              { id: "label-active", name: "Bug", color: "#00FF00" },
            ],
            removed: [],
          },
        ]}
        issueBody={null}
        attachments={[]}
        archivedLabelIds={["label-archived"]}
      />
    )

    const archivedChip = screen.getByText("Retired")
    expect(archivedChip).toBeVisible()
    expect(archivedChip).toHaveClass("line-through")
    expect(archivedChip).toHaveClass("text-muted-foreground")

    const activeChip = screen.getByText("Bug")
    expect(activeChip).not.toHaveClass("line-through")
    expect(activeChip).toHaveClass("text-foreground")
  })

  it("drops archived styling once a label is restored while preserving event text and timestamp", () => {
    // Same historical event as the archived case, but the label is no longer
    // archived (restored), so its id is absent from archivedLabelIds. Nothing
    // about the stored event changes — only the current-state styling reverts.
    render(
      <IssueTimeline
        items={[
          {
            kind: "labels-milestone",
            key: "evt-labels-restored",
            timestamp: "2026-07-01T00:00:00.000Z",
            added: [
              { id: "label-restored", name: "Retired", color: "#FF0000" },
            ],
            removed: [],
          },
        ]}
        issueBody={null}
        attachments={[]}
        archivedLabelIds={[]}
      />
    )

    const restoredChip = screen.getByText("Retired")
    expect(restoredChip).toBeVisible()
    expect(restoredChip).not.toHaveClass("line-through")
    expect(restoredChip).toHaveClass("text-foreground")

    // Event text and timestamp are untouched by the restore.
    const timestamp = document.querySelector("time")
    expect(timestamp).toHaveAttribute("datetime", "2026-07-01T00:00:00.000Z")
  })

  it("renders only the added group when nothing was removed", () => {
    render(
      <IssueTimeline
        items={[
          {
            kind: "labels-milestone",
            key: "evt-labels-added-only",
            timestamp: "2026-07-01T00:00:00.000Z",
            added: [{ id: "label-1", name: "Bug", color: "#FF0000" }],
            removed: [],
          },
        ]}
        issueBody={null}
        attachments={[]}
      />
    )

    expect(screen.getByText("Added")).toBeInTheDocument()
    expect(screen.queryByText("Removed")).not.toBeInTheDocument()
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
        issueBody={null}
        attachments={[]}
      />
    )

    expect(screen.getByText(/Pull request opened/)).toBeInTheDocument()
    expect(screen.getByText(/Pull request merged/)).toBeInTheDocument()
    const links = screen.getAllByRole("link", { name: "acme/repo#42" })
    expect(links).toHaveLength(2)
  })

  it("renders a fallback when there is no timeline activity", () => {
    render(<IssueTimeline items={[]} issueBody={null} attachments={[]} />)

    expect(screen.getByText("No activity yet.")).toBeInTheDocument()
  })
})
