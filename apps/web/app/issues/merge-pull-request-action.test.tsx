import { afterEach, describe, expect, it, vi } from "vitest"
import { ServiceError } from "@gentic/services/errors"

const revalidatePathMock = vi.fn()
const getAuthenticatedContextMock = vi.fn()
const createServiceClientMock = vi.fn()
const mergeIssuePullRequestMock = vi.fn()

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

vi.mock("@gentic/supabase/service", () => ({
  createServiceClient: () => createServiceClientMock(),
}))

vi.mock("@/lib/pull-request-merging", () => ({
  mergeIssuePullRequest: (
    ownershipSupabase: unknown,
    serviceSupabase: unknown,
    input: unknown
  ) => mergeIssuePullRequestMock(ownershipSupabase, serviceSupabase, input),
}))

vi.mock("@gentic/services/issues", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@gentic/services/issues")>()),
  getIssue: () => ({
    id: "11111111-1111-4111-8111-111111111111",
    number: 7,
    title: "Issue",
    projects: { key: "GEN" },
  }),
}))

import { mergeIssuePullRequestAction } from "./actions"

const pullRequestId = "33333333-3333-4333-8333-333333333333"

function formDataFor(id: string) {
  const formData = new FormData()
  formData.set("pull_request_id", id)
  return formData
}

afterEach(() => {
  vi.clearAllMocks()
})

describe("mergeIssuePullRequestAction server action", () => {
  it("merges with the caller's client for ownership and the service client for the merged-state write", async () => {
    const supabase = { kind: "rls" }
    const serviceClient = { kind: "service" }
    getAuthenticatedContextMock.mockResolvedValue({
      supabase,
      userId: "user-1",
    })
    createServiceClientMock.mockReturnValue(serviceClient)
    mergeIssuePullRequestMock.mockResolvedValue({
      issueId: "11111111-1111-4111-8111-111111111111",
      prUrl: "https://github.com/acme/widget/pull/42",
      mergeMethod: "squash",
      mergeCommitSha: "merge-commit-1",
    })

    await expect(
      mergeIssuePullRequestAction(formDataFor(pullRequestId))
    ).resolves.toEqual({ ok: true, mergeMethod: "squash" })

    // Ownership is resolved with the client the user's RLS applies to; only
    // the `apply_pull_request_delivery_state` RPC — granted to `service_role`
    // alone — gets the service client.
    expect(mergeIssuePullRequestMock).toHaveBeenCalledWith(
      supabase,
      serviceClient,
      { userId: "user-1", pullRequestId }
    )
    expect(revalidatePathMock).toHaveBeenCalledWith("/issues")
    expect(revalidatePathMock).toHaveBeenCalledWith("/issues/GEN-7/issue")
  })

  // Every refusal names something the operator can act on, so the button
  // shows it verbatim rather than a generic failure.
  it("returns expected service failures as serializable data", async () => {
    getAuthenticatedContextMock.mockResolvedValue({
      supabase: {},
      userId: "user-1",
    })
    mergeIssuePullRequestMock.mockRejectedValue(
      new ServiceError("conflict", "Pull request is not approved")
    )

    await expect(
      mergeIssuePullRequestAction(formDataFor(pullRequestId))
    ).resolves.toEqual({ ok: false, error: "Pull request is not approved" })
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })

  it("rejects a malformed pull request id before reaching GitHub", async () => {
    getAuthenticatedContextMock.mockResolvedValue({
      supabase: {},
      userId: "user-1",
    })

    await expect(
      mergeIssuePullRequestAction(formDataFor("not-a-uuid"))
    ).rejects.toThrow()
    expect(mergeIssuePullRequestMock).not.toHaveBeenCalled()
  })
})
