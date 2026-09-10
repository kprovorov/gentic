import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "@gentic/services/errors"

import { completeGithubCallback } from "../app/api/integrations/github/callback/route"

type Write = { userId: string; installationId: string | null }
type CreatedState = {
  userId: string
  state: string
  installationId: string | null
}

function callbackDeps(
  overrides: Partial<{
    consumeState: (
      userId: string,
      state: string
    ) => Promise<{ installationId: string | null }>
    upsertIntegration: (
      userId: string,
      input: { installationId: string | null }
    ) => Promise<unknown>
    verifyInstallationOwnership: (
      code: string,
      installationId: string
    ) => Promise<boolean>
    oauthCredentials: () => { clientId: string; clientSecret: string } | null
  }> = {}
) {
  const writes: Write[] = []
  const createdStates: CreatedState[] = []
  const consumedStates: string[] = []

  const deps = {
    async consumeState(userId: string, state: string) {
      consumedStates.push(state)
      return { installationId: null }
    },
    async createState(
      userId: string,
      state: string,
      installationId: string | null
    ) {
      createdStates.push({ userId, state, installationId })
    },
    async upsertIntegration(
      userId: string,
      input: { installationId: string | null }
    ) {
      writes.push({ userId, installationId: input.installationId })
    },
    async verifyInstallationOwnership() {
      return true
    },
    oauthCredentials: () => ({
      clientId: "Iv1.abc",
      clientSecret: "secret",
    }),
    generateState: () => "next-state",
    ...overrides,
  }

  return { deps, writes, createdStates, consumedStates }
}

function callback(query: string) {
  return new Request(
    `http://localhost/api/integrations/github/callback?${query}`
  )
}

test("GitHub callback lets the same owner complete setup repeatedly", async () => {
  const { deps, writes, consumedStates } = callbackDeps()

  const first = await completeGithubCallback(
    callback("state=first&installation_id=123&code=ghc_first"),
    "user_alpha",
    deps as never
  )
  const second = await completeGithubCallback(
    callback("state=second&installation_id=123&code=ghc_second"),
    "user_alpha",
    deps as never
  )

  assert.equal(first, "/settings?github=connected")
  assert.equal(second, "/settings?github=connected")
  assert.deepEqual(consumedStates, ["first", "second"])
  assert.deepEqual(writes, [
    { userId: "user_alpha", installationId: "123" },
    { userId: "user_alpha", installationId: "123" },
  ])
})

test("GitHub callback sends an unauthorized install through GitHub before writing", async () => {
  const { deps, writes, createdStates } = callbackDeps()

  const destination = await completeGithubCallback(
    callback("state=first&installation_id=123"),
    "user_alpha",
    deps as never
  )

  assert.equal(
    destination,
    "https://github.com/login/oauth/authorize?client_id=Iv1.abc&state=next-state"
  )
  assert.deepEqual(createdStates, [
    { userId: "user_alpha", state: "next-state", installationId: "123" },
  ])
  assert.deepEqual(writes, [])
})

test("GitHub callback resumes from the installation the state carries", async () => {
  const { deps, writes } = callbackDeps({
    async consumeState() {
      return { installationId: "123" }
    },
  })

  // The user-authorization hop comes back with a code and no installation_id.
  const destination = await completeGithubCallback(
    callback("state=next-state&code=ghc_code"),
    "user_alpha",
    deps as never
  )

  assert.equal(destination, "/settings?github=connected")
  assert.deepEqual(writes, [{ userId: "user_alpha", installationId: "123" }])
})

test("GitHub callback refuses an installation the user does not administer", async () => {
  const verified: Array<[string, string]> = []
  const { deps, writes } = callbackDeps({
    async verifyInstallationOwnership(code: string, installationId: string) {
      verified.push([code, installationId])
      return false
    },
  })

  const destination = await completeGithubCallback(
    callback("state=beta&installation_id=999&code=ghc_code"),
    "user_beta",
    deps as never
  )

  assert.equal(destination, "/settings?github=installation-unverified")
  assert.deepEqual(verified, [["ghc_code", "999"]])
  assert.deepEqual(writes, [])
})

test("GitHub callback refuses to connect when OAuth credentials are missing", async () => {
  const { deps, writes } = callbackDeps({ oauthCredentials: () => null })

  const destination = await completeGithubCallback(
    callback("state=alpha&installation_id=123&code=ghc_code"),
    "user_alpha",
    deps as never
  )

  assert.equal(destination, "/settings?github=not-configured")
  assert.deepEqual(writes, [])
})

test("GitHub callback records a pending org install without verifying anything", async () => {
  const { deps, writes } = callbackDeps({
    async verifyInstallationOwnership() {
      throw new Error("should not verify a pending request")
    },
  })

  const destination = await completeGithubCallback(
    callback("state=alpha&setup_action=request"),
    "user_alpha",
    deps as never
  )

  assert.equal(destination, "/settings?github=pending")
  assert.deepEqual(writes, [{ userId: "user_alpha", installationId: null }])
})

test("GitHub callback gives a competing account a clear conflict destination", async () => {
  let attemptedWrite = false
  const { deps } = callbackDeps({
    async upsertIntegration() {
      attemptedWrite = true
      throw new ServiceError(
        "conflict",
        "This GitHub installation is already connected to another Gentic account."
      )
    },
  })

  const destination = await completeGithubCallback(
    callback("state=beta&installation_id=123&code=ghc_code"),
    "user_beta",
    deps as never
  )

  assert.equal(attemptedWrite, true)
  assert.equal(destination, "/settings?github=installation-conflict")
})

test("GitHub callback does not hide unrelated connection errors", async () => {
  const { deps } = callbackDeps({
    async upsertIntegration() {
      throw new ServiceError("internal", "database unavailable")
    },
  })

  await assert.rejects(
    completeGithubCallback(
      callback("state=alpha&installation_id=123&code=ghc_code"),
      "user_alpha",
      deps as never
    ),
    (error) =>
      error instanceof ServiceError &&
      error.code === "internal" &&
      error.message === "database unavailable"
  )
})
