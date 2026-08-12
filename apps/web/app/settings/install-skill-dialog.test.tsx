import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { InstallSkillDialog } from "./install-skill-dialog"

const SKILL_URL = "https://skills.sh/anthropics/skills/pdf"

const targets = [
  { worker_id: "w1", display_name: "laptop", eligible: true, reason: null },
  { worker_id: "w2", display_name: "build host", eligible: true, reason: null },
  {
    worker_id: "w3",
    display_name: "old mac",
    eligible: false,
    reason: "offline" as const,
  },
  {
    worker_id: "w4",
    display_name: "busy box",
    eligible: false,
    reason: "installing" as const,
  },
]

type Route = {
  gate?: unknown
  post?: { status: number; body: unknown }
}

function stubFetch(route: Route = {}) {
  const calls: Array<{ url: string; body: unknown }> = []

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({
        url: input,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      })

      if (input.startsWith("/api/app/skills/install-targets")) {
        return jsonResponse({ workers: targets })
      }
      if (input.startsWith("/api/app/skills/audit")) {
        if (!input.includes(encodeURIComponent("skills.sh"))) {
          return jsonResponse(
            {
              error: {
                code: "validation",
                message: "Only skills.sh URLs can be installed.",
              },
            },
            400,
          )
        }
        return jsonResponse({
          skill: { source: "anthropics/skills", skill: "pdf", url: SKILL_URL },
          gate: route.gate ?? { decision: "allow", reasons: [], audits: [] },
        })
      }
      if (input.startsWith("/api/app/skills/installs")) {
        const post = route.post ?? { status: 200, body: { installs: [] } }
        return jsonResponse(post.body, post.status)
      }

      throw new Error(`Unexpected request to ${input}`)
    }),
  )

  return calls
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function renderDialog() {
  return render(<InstallSkillDialog open onOpenChange={vi.fn()} />)
}

async function enterSkillUrl(url = SKILL_URL) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText("Skill URL"), url)
  return user
}

describe("InstallSkillDialog", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it("selects every eligible worker by default and disables the rest with a reason", async () => {
    stubFetch()
    renderDialog()

    await waitFor(() => {
      expect(screen.getByLabelText("Install on laptop")).toBeChecked()
    })
    expect(screen.getByLabelText("Install on build host")).toBeChecked()

    const offline = screen.getByLabelText("Install on old mac")
    expect(offline).toBeDisabled()
    expect(offline).not.toBeChecked()
    expect(screen.getByText("Offline")).toBeVisible()

    expect(screen.getByLabelText("Install on busy box")).toBeDisabled()
    expect(screen.getByText("Installing another skill")).toBeVisible()
  })

  it("rejects a URL that does not name a single skill", async () => {
    stubFetch()
    renderDialog()
    await enterSkillUrl("https://example.com/whatever")

    await waitFor(() => {
      expect(
        screen.getByText("Only skills.sh URLs can be installed."),
      ).toBeVisible()
    })
    expect(
      screen.getByRole("button", { name: /^Install on/ }),
    ).toBeDisabled()
  })

  it("requires explicit risk acceptance when audits are not all current and passing", async () => {
    stubFetch({
      gate: {
        decision: "confirm",
        reasons: ["warning"],
        audits: [
          { provider: "Socket", status: "warn", summary: "1 alert: gptAnomaly" },
        ],
      },
    })
    renderDialog()
    const user = await enterSkillUrl()

    await waitFor(() => {
      expect(screen.getByText("Audits need your confirmation")).toBeVisible()
    })
    expect(screen.getByText("1 alert: gptAnomaly")).toBeVisible()

    const installButton = screen.getByRole("button", { name: /^Install on/ })
    expect(installButton).toBeDisabled()

    await user.click(
      screen.getByLabelText("Accept the risk and install anyway"),
    )
    expect(installButton).toBeEnabled()
  })

  it("offers no way to install a skill whose audit failed", async () => {
    stubFetch({
      gate: {
        decision: "block",
        reasons: ["failed"],
        audits: [{ provider: "Snyk", status: "fail" }],
      },
    })
    renderDialog()
    await enterSkillUrl()

    await waitFor(() => {
      expect(
        screen.getByText("Installation blocked by a failed audit"),
      ).toBeVisible()
    })
    expect(
      screen.queryByLabelText("Accept the risk and install anyway"),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Install on/ })).toBeDisabled()
  })

  it("submits the selected workers and shows a per-worker outcome with failure output", async () => {
    const calls = stubFetch({
      post: {
        status: 200,
        body: {
          installs: [
            {
              id: "i1",
              worker_id: "w1",
              status: "installed",
              error_summary: null,
              output: null,
            },
            {
              id: "i2",
              worker_id: "w2",
              status: "failed",
              error_summary: "npx skills add exited with code 1.",
              output: "npm error 404 Not Found",
            },
          ],
        },
      },
    })
    renderDialog()
    const user = await enterSkillUrl()

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Install on/ })).toBeEnabled()
    })
    await user.click(screen.getByRole("button", { name: /^Install on/ }))

    await waitFor(() => {
      expect(screen.getByText("Installed")).toBeVisible()
    })
    expect(screen.getByText("Failed")).toBeVisible()
    expect(
      screen.getByText("npx skills add exited with code 1."),
    ).toBeVisible()

    await user.click(screen.getByRole("button", { name: "Show output" }))
    expect(screen.getByText("npm error 404 Not Found")).toBeVisible()

    expect(
      calls.find((call) => call.url === "/api/app/skills/installs")?.body,
    ).toEqual({
      url: SKILL_URL,
      worker_ids: ["w1", "w2"],
      accept_risk: false,
    })
    // Dispatched commands are not cancellable, so no cancel affordance exists.
    expect(
      screen.queryByRole("button", { name: /cancel/i }),
    ).not.toBeInTheDocument()
  })

  it("re-renders the gate the server enforced when a submission is refused", async () => {
    stubFetch({
      post: {
        status: 409,
        body: {
          error: {
            code: "audit_gate",
            message: "Accept the risk to continue.",
          },
          gate: {
            decision: "confirm",
            reasons: ["stale"],
            audits: [],
          },
        },
      },
    })
    renderDialog()
    const user = await enterSkillUrl()

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Install on/ })).toBeEnabled()
    })
    await user.click(screen.getByRole("button", { name: /^Install on/ }))

    await waitFor(() => {
      expect(screen.getByText("Accept the risk to continue.")).toBeVisible()
    })
    expect(
      screen.getByLabelText("Accept the risk and install anyway"),
    ).not.toBeChecked()
    expect(screen.getByRole("button", { name: /^Install on/ })).toBeDisabled()
  })
})
