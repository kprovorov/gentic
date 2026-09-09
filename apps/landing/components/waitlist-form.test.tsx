import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import Home from "@/app/page"
import { WaitlistForm } from "./waitlist-form"

// Match Next.js static image imports; Vitest otherwise supplies URL strings.
vi.mock("@/public/screenshots/issues.png", () => ({
  default: { src: "/screenshots/issues.png", width: 2880, height: 2080 },
}))
vi.mock("@/public/screenshots/planning.png", () => ({
  default: { src: "/screenshots/planning.png", width: 2880, height: 2080 },
}))
vi.mock("@/public/screenshots/agents.png", () => ({
  default: { src: "/screenshots/agents.png", width: 1392, height: 1168 },
}))
vi.mock("@/public/screenshots/review.png", () => ({
  default: { src: "/screenshots/review.png", width: 2352, height: 1648 },
}))

const clerk = vi.hoisted(() => ({
  loaded: true,
  join: vi.fn(),
  errors: {
    fields: {} as { emailAddress?: { longMessage: string } },
  },
}))

vi.mock("@clerk/nextjs", () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) => children,
  useClerk: () => ({ loaded: clerk.loaded }),
  useWaitlist: () => ({ waitlist: { join: clerk.join }, errors: clerk.errors }),
}))

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "test-key-not-sent-to-clerk")
  clerk.loaded = true
  clerk.join.mockReset()
  clerk.errors.fields = {}
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

function submitEmail() {
  const input = screen.getByLabelText("Email address") as HTMLInputElement
  fireEvent.change(input, { target: { value: "test@example.com" } })
  fireEvent.submit(input.form!)
  return input
}

describe("inline waitlist", () => {
  it("points every acquisition link to the form on the same page", () => {
    const { container } = render(<Home />)
    const links = screen.getAllByRole("link", { name: "Join waitlist" })
    expect(links).toHaveLength(3)
    for (const link of links)
      expect(link.getAttribute("href")).toBe("#waitlist")
    expect(container.querySelector("#waitlist form")).not.toBeNull()
  })

  it("renders a required email field and prevents submission until Clerk loads", () => {
    clerk.loaded = false
    render(<WaitlistForm />)
    const input = screen.getByLabelText("Email address") as HTMLInputElement
    expect(input.type).toBe("email")
    expect(input.required).toBe(true)
    expect(input.getAttribute("aria-invalid")).toBeNull()
    expect(input.checkValidity()).toBe(false)
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
      true,
    )
    submitEmail()
    expect(clerk.join).not.toHaveBeenCalled()
  })

  it("waits for Clerk to confirm before showing success and prevents duplicate submissions", async () => {
    let resolveJoin!: (value: { error: null }) => void
    clerk.join.mockReturnValue(
      new Promise((resolve) => {
        resolveJoin = resolve
      }),
    )
    render(<WaitlistForm />)
    const input = submitEmail()
    expect(clerk.join).toHaveBeenCalledWith({
      emailAddress: "test@example.com",
    })
    expect(
      (screen.getByRole("button", { name: "Joining…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    expect(screen.queryByRole("status")).toBeNull()
    fireEvent.submit(input.form!)
    expect(clerk.join).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveJoin({ error: null })
    })
    expect(screen.getByRole("status").textContent).toContain(
      "You’re on the waitlist.",
    )
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  it.each(["response", "network"])(
    "keeps the email and allows retry after a %s error",
    async (kind) => {
      if (kind === "response")
        clerk.join.mockResolvedValueOnce({ error: new Error("Rejected") })
      else clerk.join.mockRejectedValueOnce(new Error("Offline"))
      clerk.join.mockResolvedValueOnce({ error: null })
      render(<WaitlistForm />)
      const input = submitEmail()
      await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
      expect(input.value).toBe("test@example.com")
      expect(input.getAttribute("aria-invalid")).toBeNull()
      expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
        false,
      )
      expect(screen.queryByRole("status")).toBeNull()
      fireEvent.submit(input.form!)
      await waitFor(() => expect(screen.getByRole("status")).toBeTruthy())
    },
  )

  it("only marks the email invalid after a rejected submission and clears it when edited", async () => {
    clerk.errors.fields.emailAddress = { longMessage: "Use a valid email address." }
    clerk.join.mockResolvedValueOnce({ error: new Error("Invalid email") })
    render(<WaitlistForm />)
    const input = screen.getByLabelText("Email address") as HTMLInputElement
    expect(input.getAttribute("aria-invalid")).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()

    submitEmail()
    await waitFor(() => expect(input.getAttribute("aria-invalid")).toBe("true"))
    expect(screen.getByRole("alert").textContent).toBe("Use a valid email address.")

    fireEvent.change(input, { target: { value: "corrected@example.com" } })
    expect(input.getAttribute("aria-invalid")).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("shows missing configuration as a service notice without marking the untouched email invalid", () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "")
    render(<WaitlistForm />)
    const input = screen.getByLabelText("Email address") as HTMLInputElement
    expect(input.value).toBe("")
    expect(input.getAttribute("aria-invalid")).toBeNull()
    expect(input.getAttribute("aria-describedby")).toBe("waitlist-feedback")
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.getByRole("status").textContent).toContain(
      "temporarily unavailable",
    )
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(clerk.join).not.toHaveBeenCalled()
  })
})
