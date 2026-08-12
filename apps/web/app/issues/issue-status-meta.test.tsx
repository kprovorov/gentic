import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { statusIcons } from "./issue-status-meta"

describe("statusIcons", () => {
  // The in-progress icon is a wrapper rather than a bare Tabler icon, so the
  // classes every caller passes for size and colour have to survive it.
  it("spins the in-progress icon while keeping the caller's classes", () => {
    const InProgressIcon = statusIcons["in-progress"]

    const { container } = render(
      <InProgressIcon className="size-3.5 text-blue-600" />
    )

    const icon = container.querySelector("svg")
    expect(icon?.getAttribute("class")).toContain("animate-spin")
    expect(icon?.getAttribute("class")).toContain("size-3.5")
    expect(icon?.getAttribute("class")).toContain("text-blue-600")
  })

  it("leaves a settled status icon still", () => {
    const CompletedIcon = statusIcons.completed

    const { container } = render(<CompletedIcon className="size-3.5" />)

    expect(container.querySelector("svg")?.getAttribute("class")).not.toContain(
      "animate-spin"
    )
  })
})
