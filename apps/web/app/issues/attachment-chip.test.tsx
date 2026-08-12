import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { AttachmentChip } from "./attachment-chip"

describe("AttachmentChip", () => {
  it("letterboxes the thumbnail inside the tinted preview tile", () => {
    const { container } = render(
      <AttachmentChip
        fileName="IMG_1845.jpeg"
        sizeBytes={126_755}
        thumbnailUrl="https://signed.test/IMG_1845.jpeg?thumb=1"
      />
    )

    const image = container.querySelector("img")
    // A square crop of a tall screenshot is a blank slice of its middle, and
    // without the tile behind it that slice has no visible edges at all.
    expect(image?.className).toContain("object-contain")
    expect(image?.parentElement?.className).toContain("bg-muted")
  })

  it("falls back to a file icon in the same tile when there is no preview", () => {
    const { container } = render(
      <AttachmentChip
        fileName="spec.pdf"
        sizeBytes={4096}
        thumbnailUrl={null}
      />
    )

    expect(container.querySelector("img")).toBeNull()
    expect(screen.getByText("PDF · 4.0 KB")).toBeTruthy()
    expect(container.querySelector(".bg-muted")).not.toBeNull()
  })
})
