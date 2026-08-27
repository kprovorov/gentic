import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

// `useSupabaseClient` ships from @gentic/supabase, which has no runner of its
// own; apps/web is its only consumer, so its contract is pinned here.
vi.unmock("@gentic/supabase/client")

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321"
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test"

type Session = { getToken: () => Promise<string> } | null

let session: Session = null

vi.mock("@clerk/nextjs", () => ({
  useSession: () => ({ session }),
}))

const { useSupabaseClient } = await import("@gentic/supabase/client")

function signedInAs(token: string): Session {
  return { getToken: async () => token }
}

// The client hands its `accessToken` callback down to Realtime, which is where
// the token has to stay current: Realtime re-reads it on every heartbeat.
function currentToken(client: ReturnType<typeof useSupabaseClient>) {
  return client.realtime.accessToken?.() ?? Promise.resolve(null)
}

describe("useSupabaseClient", () => {
  beforeEach(() => {
    session = signedInAs("token-1")
  })

  // The bug: Clerk replaces the session object every time it touches the
  // session — roughly once a minute — so a client keyed off `session` was
  // rebuilt on that cadence. Each rebuild dropped the Realtime WebSocket and
  // rejoined, which the issue chat rendered as "Reconnecting to live updates".
  it("survives Clerk handing back a new session object", () => {
    const { result, rerender } = renderHook(() => useSupabaseClient())
    const first = result.current

    session = signedInAs("token-2")
    rerender()

    expect(result.current).toBe(first)
  })

  it("still authenticates with the current session's token", async () => {
    const { result, rerender } = renderHook(() => useSupabaseClient())

    session = signedInAs("token-2")
    rerender()

    await expect(currentToken(result.current)).resolves.toBe("token-2")
  })

  it("reports no token while signed out", async () => {
    const { result, rerender } = renderHook(() => useSupabaseClient())

    session = null
    rerender()

    await expect(currentToken(result.current)).resolves.toBeNull()
  })
})
