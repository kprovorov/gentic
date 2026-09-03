import type React from "react"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SettingsHostsData } from "@/app/queries"

import { HostsSection } from "./hosts-section"

function renderSection(
  props: Partial<React.ComponentProps<typeof HostsSection>> = {}
) {
  const defaultProps: React.ComponentProps<typeof HostsSection> = {
    data: hostsData(),
    isLoading: false,
    isError: false,
    onRefresh: vi.fn(),
  }

  return render(<HostsSection {...defaultProps} {...props} />)
}

describe("HostsSection", () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.stubGlobal("fetch", vi.fn())
  })

  it("renders summary counts and compact host state without task names", () => {
    renderSection({
      data: hostsData({
        hosts: [baseHost()],
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
        "Update available 0.13.0 - update the Gentic CLI on this host"
      ).length
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
      screen.queryByRole("link", { name: /Task title/ })
    ).not.toBeInTheDocument()
  })

  it("generates and regenerates a single-use connection code", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          code: "gtce_first",
          expires_at: "2026-07-30T12:10:00.000Z",
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: "gtce_second",
          expires_at: "2026-07-30T12:11:00.000Z",
        })
      )

    renderSection()

    await user.click(screen.getByRole("button", { name: "Connect host" }))

    expect(
      await screen.findByText("gentic host connect gtce_first")
    ).toBeVisible()
    expect(screen.getByText(/Expires/)).toBeVisible()

    await user.click(screen.getByRole("button", { name: "New code" }))

    expect(
      await screen.findByText("gentic host connect gtce_second")
    ).toBeVisible()
    expect(
      screen.queryByText("gentic host connect gtce_first")
    ).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("copies the connect command to the clipboard", async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } })
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({
        code: "gtce_first",
        expires_at: "2026-07-30T12:10:00.000Z",
      })
    )

    renderSection()

    await user.click(screen.getByRole("button", { name: "Connect host" }))
    expect(
      await screen.findByText("gentic host connect gtce_first")
    ).toBeVisible()

    await user.click(screen.getByRole("button", { name: "Copy command" }))

    expect(writeText).toHaveBeenCalledWith("gentic host connect gtce_first")
    expect(await screen.findByRole("button", { name: "Copied" })).toBeVisible()
  })

  it("updates display when polling supplies fresh host data", () => {
    const { rerender } = renderSection()

    expect(screen.getByText("Build host")).toBeVisible()
    expect(screen.getByText("2/4")).toBeVisible()

    rerender(
      <HostsSection
        data={hostsData({
          hosts: [
            {
              ...baseHost(),
              editableName: "Build host updated",
              runningCount: 3,
            },
          ],
          summary: { online: 1, offline: 0, banned: 0 },
        })}
        isLoading={false}
        isError={false}
        onRefresh={vi.fn()}
      />
    )

    expect(screen.getByText("Build host updated")).toBeVisible()
    expect(screen.getByText("3/4")).toBeVisible()
  })

  it("renames a host inline and reports duplicate names clearly", async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn()
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ host: {} }))

    renderSection({
      data: hostsData({ hosts: [baseHost(), otherHost()] }),
      onRefresh,
    })

    await user.click(screen.getByRole("button", { name: "Rename Build host" }))
    const input = screen.getByLabelText("Display name for Build host")
    await user.clear(input)
    await user.type(input, "Edge runner")
    await user.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/app/hosts/host-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ display_name: "Edge runner" }),
        })
      )
    })
    expect(onRefresh).toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Rename Build host" }))
    await user.clear(screen.getByLabelText("Display name for Build host"))
    await user.type(
      screen.getByLabelText("Display name for Build host"),
      "Other host"
    )
    await user.click(screen.getByRole("button", { name: "Save" }))

    expect(
      screen.getByText("A host with this name already exists.")
    ).toBeVisible()
  })

  it("confirms ban with the active task interruption count", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ host: {} }))

    renderSection()

    await user.click(
      screen.getByRole("button", { name: "Host actions for Build host" })
    )
    await user.click(screen.getByRole("menuitem", { name: "Ban" }))

    expect(
      screen.getByText(/interrupt and requeue 2 active tasks/)
    ).toBeVisible()

    await user.click(screen.getByRole("button", { name: "Ban host" }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/app/hosts/host-1/ban",
        expect.objectContaining({ method: "POST" })
      )
    })
  })

  it("requires the exact host name before typed deletion and hides deleted hosts", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true }))

    renderSection()

    await user.click(
      screen.getByRole("button", { name: "Host actions for Build host" })
    )
    await user.click(screen.getByRole("menuitem", { name: "Delete" }))

    expect(
      screen.getByText(/permanently revokes the host credential/i)
    ).toBeVisible()
    expect(screen.getByRole("button", { name: "Delete host" })).toBeDisabled()

    await user.type(screen.getByLabelText("Display name"), "Build host")
    await user.click(screen.getByRole("button", { name: "Delete host" }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/app/hosts/host-1",
        expect.objectContaining({ method: "DELETE" })
      )
    })
    await waitFor(() => {
      expect(screen.queryByText("Build host")).not.toBeInTheDocument()
    })
  })

  it("unbans banned hosts from the actions menu", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ host: {} }))

    renderSection({ data: hostsData({ hosts: [bannedHost()] }) })

    await user.click(
      screen.getByRole("button", { name: "Host actions for Banned host" })
    )
    await user.click(screen.getByRole("menuitem", { name: "Unban" }))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/app/hosts/host-banned/unban",
        expect.objectContaining({ method: "POST" })
      )
    })
  })

  it("shows failures for code generation and host actions", async () => {
    const user = userEvent.setup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "Code failed" } }, false)
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "Ban failed" } }, false)
      )

    renderSection()

    await user.click(screen.getByRole("button", { name: "Connect host" }))
    expect(await screen.findByText("Code failed")).toBeVisible()

    await user.click(screen.getByRole("button", { name: "Close" }))
    await user.click(
      screen.getByRole("button", { name: "Host actions for Build host" })
    )
    await user.click(screen.getByRole("menuitem", { name: "Ban" }))
    await user.click(screen.getByRole("button", { name: "Ban host" }))

    expect(await screen.findByText("Ban failed")).toBeVisible()
  })
})

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  } as Response
}

function hostsData(
  overrides: Partial<SettingsHostsData> = {}
): SettingsHostsData {
  const hosts = overrides.hosts ?? [
    baseHost(),
    {
      ...baseHost(),
      id: "host-setup",
      editableName: "Setup host",
      primaryState: "setup-incomplete",
      setupCompleted: false,
      runningCount: 0,
    },
    bannedHost(),
  ]

  return {
    hosts,
    summary: overrides.summary ?? {
      online: hosts.filter((host) => host.primaryState === "online").length,
      offline: hosts.filter((host) => host.primaryState === "offline").length,
      banned: hosts.filter((host) => host.primaryState === "banned").length,
    },
  }
}

function baseHost() {
  return {
    id: "host-1",
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
  } satisfies SettingsHostsData["hosts"][number]
}

function otherHost() {
  return {
    ...baseHost(),
    id: "host-2",
    editableName: "Other host",
    runningCount: 0,
  }
}

function bannedHost() {
  return {
    ...baseHost(),
    id: "host-banned",
    editableName: "Banned host",
    primaryState: "banned",
    runningCount: 1,
  } satisfies SettingsHostsData["hosts"][number]
}
