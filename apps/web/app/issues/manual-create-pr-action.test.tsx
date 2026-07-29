import { afterEach, describe, expect, it, vi } from "vitest"
import { ServiceError } from "@gentic/services/errors"

const revalidatePathMock = vi.fn()
const getAuthenticatedContextMock = vi.fn()
const createManualFirstPrPublishMessageMock = vi.fn()

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePathMock(path),
}))

vi.mock("server-only", () => ({}))

vi.mock("node:crypto", () => ({
  default: {
    randomUUID: () => "22222222-2222-4222-8222-222222222222",
  },
  randomUUID: () => "22222222-2222-4222-8222-222222222222",
}))

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}))

vi.mock("next/server", () => ({
  after: vi.fn(),
}))

vi.mock("../_lib/auth-context", () => ({
  getAuthenticatedContext: () => getAuthenticatedContextMock(),
}))

vi.mock("@gentic/services/issues", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@gentic/services/issues")>()),
  createManualFirstPrPublishMessage: (
    supabase: unknown,
    userId: string,
    issueId: string
  ) => createManualFirstPrPublishMessageMock(supabase, userId, issueId),
  getIssue: () => ({
    id: "11111111-1111-4111-8111-111111111111",
    number: 7,
    title: "Issue",
    projects: { key: "GEN" },
  }),
}))

import { createManualIssuePullRequest } from "./actions"

afterEach(() => {
  vi.clearAllMocks()
})

describe("createManualIssuePullRequest server action", () => {
  it("delegates to the manual first-PR service and revalidates the issue", async () => {
    const supabase = {}
    getAuthenticatedContextMock.mockResolvedValue({ supabase, userId: "user-1" })
    createManualFirstPrPublishMessageMock.mockResolvedValue({
      id: "message-1",
      created_at: "2026-07-29T12:00:00.000Z",
      content: "Create a PR",
      created: true,
    })
    const formData = new FormData()
    formData.set("issue_id", "11111111-1111-4111-8111-111111111111")

    await expect(createManualIssuePullRequest(formData)).resolves.toEqual({
      ok: true,
      id: "message-1",
      created_at: "2026-07-29T12:00:00.000Z",
      content: "Create a PR",
      created: true,
    })
    expect(createManualFirstPrPublishMessageMock).toHaveBeenCalledWith(
      supabase,
      "user-1",
      "11111111-1111-4111-8111-111111111111"
    )
    expect(revalidatePathMock).toHaveBeenCalledWith("/issues/GEN-7/issue")
  })

  it("returns expected service failures as serializable data", async () => {
    getAuthenticatedContextMock.mockResolvedValue({
      supabase: {},
      userId: "user-1",
    })
    createManualFirstPrPublishMessageMock.mockRejectedValue(
      new ServiceError("validation", "Issue already has a pull request")
    )
    const formData = new FormData()
    formData.set("issue_id", "11111111-1111-4111-8111-111111111111")

    await expect(createManualIssuePullRequest(formData)).resolves.toEqual({
      ok: false,
      error: "Issue already has a pull request",
    })
  })
})
