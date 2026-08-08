import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import type { Attachment } from "./attachments"
import { IssueRequestBody } from "./issue-request-body"

// attachments.tsx also exports the upload/delete manager, which pulls in
// server actions (and transitively `server-only`); stub it out since this
// suite only exercises the read-only `AttachmentPreviews` list.
vi.mock("@/app/issues/actions", () => ({
  deleteAttachment: vi.fn(),
  uploadAttachments: vi.fn(),
}))

const attachment: Attachment = {
  id: "attachment-1",
  fileName: "screenshot.png",
  sizeBytes: 1024,
  url: "https://files.example.com/screenshot.png",
  thumbnailUrl: null,
}

describe("IssueRequestBody", () => {
  it("renders an expanded request card with the body and attachments", () => {
    render(<IssueRequestBody body="Fix the flaky test" attachments={[attachment]} />)

    expect(screen.getByText("Request")).toBeInTheDocument()
    expect(screen.getByText("Fix the flaky test")).toBeInTheDocument()
    expect(screen.getByText("screenshot.png")).toBeInTheDocument()
  })

  it("collapses and expands on toggle", async () => {
    const user = userEvent.setup()
    render(
      <IssueRequestBody
        body={"Fix the flaky test\nIt fails intermittently in CI."}
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

  it("still shows the request card when the body is empty", () => {
    render(<IssueRequestBody body={null} attachments={[attachment]} />)

    expect(screen.getByText("Request")).toBeInTheDocument()
    expect(screen.getByText("No body provided.")).toBeInTheDocument()
    expect(screen.getByText("screenshot.png")).toBeInTheDocument()
  })
})
