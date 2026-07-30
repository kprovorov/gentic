import type React from "react"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SettingsWorkersData } from "@/app/queries"

import { ConnectedWorkersSection } from "./connected-workers-section"

function renderSection(
  props: Partial<React.ComponentProps<typeof ConnectedWorkersSection>> = {},
) {
  const defaultProps: React.ComponentProps<typeof ConnectedWorkersSection> = {
    data: workersData(),
    isLoading: false,
    isError: false,
    onRefresh: vi.fn(),
  }

  return render(<ConnectedWorkersSection {...defaultProps} {...props} />)
}

describe("ConnectedWorkersSection", () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.stubGlobal("fetch", vi.fn())
  })

  it("renders summary counts and compact worker state without task names", () => {
    renderSection({
      data: workersData({
        workers: [baseWorker()],
        summary: { online: 1, offline: 2, banned: 3 },
      }),
    })

    expect(screen.getAllByText("Online").length).toBeGreaterThan(0)
    expect(screen.getByText("Offline")).toBeVisible()
    expect(screen.getAllByText("Banned").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Setup incomplete").length).toBeGreaterThan(0)
    expect(screen.getByText("Build host")).toBeVisible()
    expect(screen.getAllByText("Online").length).toBeGreaterThan(0)
    expect(
      screen.getAllByText(
        "Update available 0.13.0 - install the latest Gentic worker locally",
      ).length,
    ).toBeGreaterThan(0)
    expect(screen.getByText("2/4")).toBeVisible()
    expect(screen.getByText("linux / x64")).toBeVisible()
    expect(screen.getByText("Claude Code")).toBeVisible()
    expect(screen.getByText("Ready 5.0.0")).toBeVisible()
    expect(screen.getByText("Codex")).toBeVisible()
    expect(screen.getByText("Needs auth 1.2.3")).toBeVisible()
    expect(screen.getByText("2 active")).toBeVisible()
    expect(screen.queryByText("Task title")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: /Task title/ }),
    ).not.toBeInTheDocument()
  })

  it("generates and regenerates a single-use connection code", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          code: "gtce_first",
          expires_at: "2026-07-30T12:10:00.000Z",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: "gtce_second",
          expires_at: "2026-07-30T12:11:00.000Z",
        }),
      )

    renderSection()

    await user.click(screen.getByRole("button", { name: "Connect worker" }))

    expect(
      await screen.findByText("gentic worker connect gtce_first"),
    ).toBeVisible()
    expect(screen.getByText(/Expires/)).toBeVisible()

    await user.click(screen.getByRole("button", { name: "New code" }))

    expect(
      await screen.findByText("gentic worker connect gtce_second"),
    ).toBeVisible()
    expect(
      screen.queryByText("gentic worker connect gtce_first"),
    ).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("updates display when polling supplies fresh worker data", () => {
    const { rerender } = renderSection()

    expect(screen.getByText("Build host")).toBeVisible()
    expect(screen.getByText("2/4")).toBeVisible()

    rerender(
      <ConnectedWorkersSection
        data={workersData({
          workers: [
            {
              ...baseWorker(),
              editableName: "Build host updated",
              runningCount: 3,
            },
          ],
          summary: { online: 1, offline: 0, banned: 0 },
        })}
        isLoading={false}
        isError={false}
        onRefresh={vi.fn()}
      />,
    )

    expect(screen.getByText("Build host updated")).toBeVisible()
    expect(screen.getByText("3/4")).toBeVisible()
  })

  it("renames a worker inline and reports duplicate names clearly", async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ worker: {} }))

    renderSection({
      data: workersData({ workers: [baseWorker(), otherWorker()] }),
      onRefresh,
    })

    await user.click(screen.getByRole("button", { name: "Rename Build host" }))
    const input = screen.getByLabelText("Worker name for Build host")
    await user.clear(input)
    await user.type(input, "Edge runner")
    await user.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/app/workers/worker-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ display_name: "Edge runner" }),
        }),
      )
    })
    expect(onRefresh).toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Rename Build host" }))
    await user.clear(screen.getByLabelText("Worker name for Build host"))
    await user.type(
      screen.getByLabelText("Worker name for Build host"),
      "Other worker",
    )
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(
      screen.getByText("A worker with this name already exists."),
    ).toBeVisible()
  })

  it("confirms ban with the active task interruption count", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ worker: {} }))

    renderSection()

    await user.click(
      screen.getByRole("button", { name: "Worker actions for Build host" }),
    )
    await user.click(screen.getByRole("menuitem", { name: "Ban" }))

    expect(
      screen.getByText(/interrupt and requeue 2 active tasks/),
    ).toBeVisible()

    await user.click(screen.getByRole("button", { name: "Ban worker" }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/app/workers/worker-1/ban",
        expect.objectContaining({ method: "POST" }),
      )
    })
  })

  it("requires the exact worker name before typed deletion and hides deleted workers", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true }))

    renderSection()

    await user.click(
      screen.getByRole("button", { name: "Worker actions for Build host" }),
    )
    await user.click(screen.getByRole("menuitem", { name: "Delete" }))

    expect(
      screen.getByText(/permanently revokes the worker credential/i),
    ).toBeVisible()
    expect(screen.getByRole("button", { name: "Delete worker" })).toBeDisabled()

    await user.type(screen.getByLabelText("Worker name"), "Build host")
    await user.click(screen.getByRole("button", { name: "Delete worker" }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/app/workers/worker-1",
        expect.objectContaining({ method: "DELETE" }),
      )
    })
    await waitFor(() => {
      expect(screen.queryByText("Build host")).not.toBeInTheDocument()
    })
  })

  it("unbans banned workers from the actions menu", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ worker: {} }))

    renderSection({ data: workersData({ workers: [bannedWorker()] }) })

    await user.click(
      screen.getByRole("button", { name: "Worker actions for Banned host" }),
    )
    await user.click(screen.getByRole("menuitem", { name: "Unban" }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/app/workers/worker-banned/unban",
        expect.objectContaining({ method: "POST" }),
      )
    })
  })

  it("shows failures for code generation and worker actions", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "Code failed" } }, false),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "Ban failed" } }, false),
      )

    renderSection()

    await user.click(screen.getByRole("button", { name: "Connect worker" }))
    expect(await screen.findByText("Code failed")).toBeVisible()

    await user.click(screen.getByRole("button", { name: "Close" }))
    await user.click(
      screen.getByRole("button", { name: "Worker actions for Build host" }),
    )
    await user.click(screen.getByRole("menuitem", { name: "Ban" }))
    await user.click(screen.getByRole("button", { name: "Ban worker" }))

    expect(await screen.findByText("Ban failed")).toBeVisible()
  })
})

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  } as Response
}

function workersData(
  overrides: Partial<SettingsWorkersData> = {},
): SettingsWorkersData {
  const workers = overrides.workers ?? [
    baseWorker(),
    {
      ...baseWorker(),
      id: "worker-setup",
      editableName: "Setup host",
      primaryState: "setup-incomplete",
      setupCompleted: false,
      runningCount: 0,
    },
    bannedWorker(),
  ]

  return {
    workers,
    summary: overrides.summary ?? {
      online: workers.filter((worker) => worker.primaryState === "online")
        .length,
      offline: workers.filter((worker) => worker.primaryState === "offline")
        .length,
      banned: workers.filter((worker) => worker.primaryState === "banned")
        .length,
    },
  }
}

function baseWorker() {
  return {
    id: "worker-1",
    editableName: "Build host",
    primaryState: "online",
    genticVersion: "0.13.0",
    genticVersionHealth: "update-available",
    runningCount: 2,
    configuredCapacity: 4,
    lastSeenAt: "2026-07-30T11:59:30.000Z",
    os: "linux",
    architecture: "x64",
    processStartedAt: "2026-07-30T08:00:00.000Z",
    connectedAt: "2026-07-29T12:00:00.000Z",
    setupCompleted: true,
    providers: {
      claude_code: {
        installed: true,
        authenticated: true,
        version: "5.0.0",
      },
      codex: {
        installed: true,
        authenticated: false,
        version: "1.2.3",
      },
    },
  } satisfies SettingsWorkersData["workers"][number]
}

function otherWorker() {
  return {
    ...baseWorker(),
    id: "worker-2",
    editableName: "Other worker",
    runningCount: 0,
  }
}

function bannedWorker() {
  return {
    ...baseWorker(),
    id: "worker-banned",
    editableName: "Banned host",
    primaryState: "banned",
    runningCount: 1,
  } satisfies SettingsWorkersData["workers"][number]
}
