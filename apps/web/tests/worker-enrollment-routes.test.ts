import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "@gentic/services/errors"

import { createWorkerEnrollmentCodeHandler } from "../app/api/app/workers/enrollment-code/route"
import { createWorkerExchangeHandler } from "../app/api/v1/workers/exchange/route"

test("worker enrollment code route requires an authenticated user", async () => {
  const handler = createWorkerEnrollmentCodeHandler({
    getContext: async () => null,
    createCode: async () => {
      throw new Error("should not create code")
    },
  })

  const response = await handler()

  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), {
    error: { code: "unauthorized", message: "Unauthorized" },
  })
})

test("worker enrollment code route creates a single-use code for the authenticated user", async () => {
  const supabase = {}
  const handler = createWorkerEnrollmentCodeHandler({
    getContext: async () => ({ supabase, userId: "user_1" }) as never,
    createCode: async (actualSupabase, userId) => {
      assert.equal(actualSupabase, supabase)
      assert.equal(userId, "user_1")
      return {
        code: "gtce_connection-code",
        expires_at: "2026-07-29T08:40:00.000Z",
      }
    },
  })

  const response = await handler()

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    code: "gtce_connection-code",
    expires_at: "2026-07-29T08:40:00.000Z",
  })
})

test("worker exchange route returns the raw credential on successful exchange", async () => {
  const supabase = {}
  let capturedRateLimitKey: string | undefined
  const handler = createWorkerExchangeHandler({
    createSupabase: () => supabase as never,
    exchange: async (actualSupabase, body, options) => {
      assert.equal(actualSupabase, supabase)
      assert.deepEqual(body, { code: "gtce_connection-code" })
      assert.ok(options)
      capturedRateLimitKey = options.rateLimitKey
      return {
        credential: "gtwc_worker-credential",
        worker: {
          id: "worker-1",
          display_name: "Build Host",
          setup_state: "enrolling",
        },
      } as never
    },
  })

  const response = await handler(
    new Request("http://localhost/api/v1/workers/exchange", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "198.51.100.7, 10.0.0.1",
        "user-agent": "gentic-test",
      },
      body: JSON.stringify({ code: "gtce_connection-code" }),
    })
  )

  assert.equal(response.status, 200)
  assert.equal(capturedRateLimitKey, "198.51.100.7:gentic-test")
  assert.deepEqual(await response.json(), {
    worker: {
      id: "worker-1",
      display_name: "Build Host",
      setup_state: "enrolling",
    },
    credential: "gtwc_worker-credential",
  })
})

test("worker exchange route keeps failures non-enumerable", async () => {
  const handler = createWorkerExchangeHandler({
    createSupabase: () => ({}) as never,
    exchange: async () => {
      throw new ServiceError("validation", "expired")
    },
  })

  const response = await handler(
    new Request("http://localhost/api/v1/workers/exchange", {
      method: "POST",
      body: JSON.stringify({ code: "gtce_expired" }),
    })
  )

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), {
    error: "Invalid enrollment code",
  })
})
