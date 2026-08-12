import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { Attachment } from "./attachments"
import { IssueRequestBody } from "./issue-request-body"

// attachments.tsx also exports the upload/delete manager, which pulls in
// server actions (and transitively `server-only`); stub it out since this
// suite only exercises the read-only `AttachmentPreviews` list.
vi.mock("@/app/issues/actions", () => ({
  startAttachmentUploads: vi.fn(),
  finishAttachmentUploads: vi.fn(),
}))

const attachment: Attachment = {
  id: "attachment-1",
  fileName: "screenshot.png",
  sizeBytes: 1024,
  url: "https://files.example.com/screenshot.png",
  thumbnailUrl: null,
}

describe("IssueRequestBody", () => {
  it("renders the request with the body and attachments", () => {
    render(
      <IssueRequestBody body="Fix the flaky test" attachments={[attachment]} />
    )

    expect(screen.getByRole("region", { name: "Request" })).toBeInTheDocument()
    expect(screen.getByText("Fix the flaky test")).toBeInTheDocument()
    expect(screen.getByText("screenshot.png")).toBeInTheDocument()
  })

  it("still shows the request when the body is empty", () => {
    render(<IssueRequestBody body={null} attachments={[attachment]} />)

    expect(screen.getByRole("region", { name: "Request" })).toBeInTheDocument()
    expect(screen.getByText("No body provided.")).toBeInTheDocument()
    expect(screen.getByText("screenshot.png")).toBeInTheDocument()
  })
})
