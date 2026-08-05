import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "@gentic/services/errors"

import { completeGithubCallback } from "../app/api/integrations/github/callback/route"

test("GitHub callback lets the same owner complete setup repeatedly", async () => {
  const consumedStates: string[] = []
  const writes: Array<{ userId: string; installationId: string | null }> = []
  const deps = {
    async consumeState(userId: string, state: string) {
      assert.equal(userId, "user_alpha")
      consumedStates.push(state)
    },
    async upsertIntegration(
      userId: string,
      input: { installationId: string | null }
    ) {
      writes.push({ userId, installationId: input.installationId })
    },
  }

  const first = await completeGithubCallback(
    new Request(
      "http://localhost/api/integrations/github/callback?state=first&installation_id=123"
    ),
    "user_alpha",
    deps as never
  )
  const second = await completeGithubCallback(
    new Request(
      "http://localhost/api/integrations/github/callback?state=second&installation_id=123"
    ),
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

test("GitHub callback gives a competing account a clear conflict destination", async () => {
  let attemptedWrite = false
  const destination = await completeGithubCallback(
    new Request(
      "http://localhost/api/integrations/github/callback?state=beta&installation_id=123"
    ),
    "user_beta",
    {
      async consumeState() {},
      async upsertIntegration() {
        attemptedWrite = true
        throw new ServiceError(
          "conflict",
          "This GitHub installation is already connected to another Gentic account."
        )
      },
    }
  )

  assert.equal(attemptedWrite, true)
  assert.equal(destination, "/settings?github=installation-conflict")
})

test("GitHub callback does not hide unrelated connection errors", async () => {
  await assert.rejects(
    completeGithubCallback(
      new Request(
        "http://localhost/api/integrations/github/callback?state=alpha&installation_id=123"
      ),
      "user_alpha",
      {
        async consumeState() {},
        async upsertIntegration() {
          throw new ServiceError("internal", "database unavailable")
        },
      }
    ),
    (error) =>
      error instanceof ServiceError &&
      error.code === "internal" &&
      error.message === "database unavailable"
  )
})
