import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SettingsHost } from "@/app/queries"

import { UpdateHostToolsDialog } from "./update-host-tools-dialog"

type Update = {
  id: string
  host_id: string
  tool: "gentic" | "claude_code" | "codex" | "github"
  status: "waiting" | "updating" | "updated" | "failed" | "timed-out"
  summary: string | null
  output: string | null
  version: string | null
  created_at: string
  expires_at: string
}

function update(overrides: Partial<Update> = {}): Update {
  return {
    id: "u1",
    host_id: "host-1",
    tool: "github",
    status: "waiting",
    summary: null,
    output: null,
    version: null,
    created_at: "2026-09-23T12:00:00.000Z",
    expires_at: "2026-09-23T12:30:00.000Z",
    ...overrides,
  }
}

function stubFetch(options: {
  lists: Update[][]
  post?: { status: number; body: unknown }
}) {
  const calls: Array<{ url: string; method: string; body: unknown }> = []
  const lists = [...options.lists]

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({
        url: input,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      })

      if (init?.method === "POST") {
        const post = options.post ?? { status: 200, body: { update: update() } }
        return jsonResponse(post.body, post.status)
      }

      // Serve the scripted lists in order and keep repeating the last one.
      const next = lists.length > 1 ? lists.shift()! : lists[0]
      return jsonResponse({ updates: next })
    })
  )

  return calls
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function host(overrides: Partial<SettingsHost> = {}): SettingsHost {
  return {
    id: "host-1",
    editableName: "Build host",
    primaryState: "online",
    genticVersion: "0.27.0",
    genticVersionHealth: "current",
    runningCount: 0,
    configuredCapacity: 1,
    lastSeenAt: "2026-09-23T12:00:00.000Z",
    os: "linux",
    architecture: "x64",
    processStartedAt: "2026-09-23T08:00:00.000Z",
    connectedAt: "2026-09-22T12:00:00.000Z",
    setupCompleted: true,
    providers: {
      claude_code: { installed: true, authenticated: true, version: "2.0.1" },
      codex: { installed: false, authenticated: null, version: null },
      github: { installed: true, authenticated: false, version: "2.60.0" },
    },
    ...overrides,
  }
}

function renderDialog(hostOverrides: Partial<SettingsHost> = {}) {
  return render(
    <UpdateHostToolsDialog
      host={host(hostOverrides)}
      open
      onOpenChange={vi.fn()}
    />
  )
}

describe("UpdateHostToolsDialog", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("lists the four tools with what the host reports for each", async () => {
    stubFetch({ lists: [[]] })
    renderDialog()

    expect(screen.getByText("Update tools on Build host")).toBeVisible()
    expect(screen.getByText("Running 0.27.0")).toBeVisible()
    expect(screen.getByText("Installed 2.0.1")).toBeVisible()
    expect(screen.getByText("Not installed")).toBeVisible()
    expect(screen.getByText("Installed 2.60.0, needs auth")).toBeVisible()

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Update Gentic" })
      ).toBeEnabled()
    })
    expect(
      screen.getByRole("button", { name: "Update GitHub CLI" })
    ).toBeEnabled()
  })

  it("queues an update and follows it to its outcome", async () => {
    const calls = stubFetch({
      lists: [
        [],
        [update({ status: "updating" })],
        [
          update({
            status: "updated",
            summary: "Updated to 2.61.0",
            version: "2.61.0",
          }),
        ],
      ],
    })
    renderDialog()
    const user = userEvent.setup()

    const button = await screen.findByRole("button", {
      name: "Update GitHub CLI",
    })
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)

    expect(await screen.findByText("Waiting")).toBeVisible()
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent("Updating...")
    expect(calls.find((call) => call.method === "POST")).toMatchObject({
      url: "/api/app/hosts/host-1/tool-updates",
      body: { tool: "github" },
    })

    expect(
      await screen.findByText("Updated", {}, { timeout: 6_000 })
    ).toBeVisible()
    expect(screen.getByText("Updated to 2.61.0")).toBeVisible()
    expect(button).toBeEnabled()
  }, 10_000)

  it("shows a failure with its output behind a toggle", async () => {
    stubFetch({
      lists: [
        [
          update({
            tool: "gentic",
            status: "failed",
            summary: "npm install -g gentic-cli@latest exited with code 1.",
            output: "npm error EACCES: permission denied",
          }),
        ],
      ],
    })
    renderDialog()
    const user = userEvent.setup()

    expect(await screen.findByText("Failed")).toBeVisible()
    expect(
      screen.getByText("npm install -g gentic-cli@latest exited with code 1.")
    ).toBeVisible()
    expect(
      screen.queryByText("npm error EACCES: permission denied")
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Show output" }))

    expect(
      screen.getByText("npm error EACCES: permission denied")
    ).toBeVisible()
  })

  it("surfaces a refused request next to the tool", async () => {
    stubFetch({
      lists: [[]],
      post: {
        status: 409,
        body: {
          error: {
            code: "conflict",
            message: "Codex is already being updated on this host.",
          },
        },
      },
    })
    renderDialog()
    const user = userEvent.setup()

    const button = await screen.findByRole("button", { name: "Update Codex" })
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)

    expect(
      await screen.findByText("Codex is already being updated on this host.")
    ).toBeVisible()
    expect(button).toBeEnabled()
  })

  it("disables every update on a host that cannot run one", async () => {
    stubFetch({ lists: [[]] })
    renderDialog({ primaryState: "offline" })

    expect(
      screen.getByText(
        "This host is offline. Updates can be queued once it reconnects."
      )
    ).toBeVisible()
    await waitFor(() => {
      expect(fetch).toHaveBeenCalled()
    })
    for (const button of screen.getAllByRole("button", { name: /^Update / })) {
      expect(button).toBeDisabled()
    }
  })
})
