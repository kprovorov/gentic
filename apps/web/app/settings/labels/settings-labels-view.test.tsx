import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createLabel, updateLabel } from "@/app/settings/actions"
import type { SettingsLabelsData } from "@/app/queries"

import { SettingsLabelsView } from "./settings-labels-view"

vi.mock("@/app/settings/actions", () => ({
  createLabel: vi.fn().mockResolvedValue(undefined),
  updateLabel: vi.fn().mockResolvedValue(undefined),
}))

function renderLabelsView(data: SettingsLabelsData = labelsData()) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return {
    queryClient,
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={queryClient}>
        <SettingsLabelsView initialData={data} />
      </QueryClientProvider>
    ),
  }
}

describe("SettingsLabelsView", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("fetch", vi.fn())
  })

  it("lists active labels alphabetically with assignment counts", () => {
    renderLabelsView()
    const alphaInput = screen.getByDisplayValue("Alpha")
    const betaInput = screen.getByDisplayValue("beta")

    expect(
      alphaInput.compareDocumentPosition(betaInput) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(alphaInput).toBeVisible()
    expect(betaInput).toBeVisible()
    expect(screen.getByText("2")).toBeVisible()
    expect(screen.getByText("1")).toBeVisible()
  })

  it("creates with no color so the service can choose the least-used preset", async () => {
    const { user } = renderLabelsView()

    await user.type(screen.getAllByLabelText("Name")[0], "Gamma")
    await user.click(screen.getByRole("button", { name: "Add label" }))

    await waitFor(() => {
      expect(createLabel).toHaveBeenCalledTimes(1)
    })
    const formData = vi.mocked(createLabel).mock.calls[0][0] as FormData
    expect(formData.get("name")).toBe("Gamma")
    expect(formData.get("color")).toBeNull()
  })

  it("supports the 48-color palette and opaque custom colors on create", async () => {
    const { user } = renderLabelsView()

    expect(screen.getAllByRole("button", { name: /^Use #/ })).toHaveLength(48)
    await user.click(screen.getByRole("button", { name: "Use #2563EB" }))
    await user.type(screen.getAllByLabelText("Name")[0], "Blue")
    await user.click(screen.getByRole("button", { name: "Add label" }))

    await waitFor(() => {
      expect(createLabel).toHaveBeenCalledTimes(1)
    })
    let formData = vi.mocked(createLabel).mock.calls[0][0] as FormData
    expect(formData.get("color")).toBe("#2563EB")

    vi.mocked(createLabel).mockClear()
    await user.type(screen.getAllByLabelText("Name")[0], "Custom")
    await user.clear(screen.getByLabelText("Custom"))
    await user.type(screen.getByLabelText("Custom"), "#1D4ED8")
    await user.click(screen.getByRole("button", { name: "Add label" }))

    await waitFor(() => {
      expect(createLabel).toHaveBeenCalledTimes(1)
    })
    formData = vi.mocked(createLabel).mock.calls[0][0] as FormData
    expect(formData.get("color")).toBe("#1D4ED8")
  })

  it("renames and recolors existing active labels by stable id", async () => {
    const { user } = renderLabelsView()

    const alphaInput = screen.getByDisplayValue("Alpha")
    const alphaForm = alphaInput.closest("form")
    expect(alphaForm).not.toBeNull()
    const alphaScope = within(alphaForm as HTMLFormElement)

    await user.clear(alphaInput)
    await user.type(alphaInput, "Done")
    await user.clear(alphaScope.getByDisplayValue("#2563EB"))
    await user.type(alphaScope.getByDisplayValue(""), "#1D4ED8")
    await user.click(alphaScope.getByRole("button", { name: "Save" }))

    await waitFor(() => {
      expect(updateLabel).toHaveBeenCalledTimes(1)
    })
    const formData = vi.mocked(updateLabel).mock.calls[0][0] as FormData
    expect(formData.get("id")).toBe("label-alpha")
    expect(formData.get("name")).toBe("Done")
    expect(formData.get("color")).toBe("#1D4ED8")
  })
})

function labelsData(): SettingsLabelsData {
  return {
    labels: [
      {
        id: "label-alpha",
        name: "Alpha",
        color: "#2563EB",
        state: "active",
        created_at: "2026-08-04T00:00:00.000Z",
        updated_at: "2026-08-04T00:00:00.000Z",
        assignment_count: 2,
      },
      {
        id: "label-beta",
        name: "beta",
        color: "#1D4ED8",
        state: "active",
        created_at: "2026-08-04T00:00:00.000Z",
        updated_at: "2026-08-04T00:00:00.000Z",
        assignment_count: 1,
      },
    ],
  }
}
