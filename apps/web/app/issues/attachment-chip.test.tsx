import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { AttachmentChip } from "./attachment-chip"

describe("AttachmentChip", () => {
  // jsdom has no layout, so nothing here can catch the clipping itself; the
  // guard is that the outline stays inside the chip's own box. A ring paints
  // outside it, and the chip renders flush against the bottom of a scroll
  // container (the request body, a chat bubble), which shaves that line off.
  it("draws its outline as a border rather than an outset ring", () => {
    const { container } = render(
      <AttachmentChip fileName="spec.pdf" sizeBytes={4096} />
    )

    const chip = container.firstElementChild
    expect(chip?.className).toContain("border")
    expect(chip?.className).not.toContain("ring-1")
  })

  it("keeps the destructive palette on the border for an invalid file", () => {
    const { container } = render(
      <AttachmentChip fileName="huge.zip" sizeBytes={26_214_400} invalid />
    )

    const chip = container.firstElementChild
    expect(chip?.className).toContain("border-destructive")
    expect(chip?.className).not.toContain("ring-destructive")
  })

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
