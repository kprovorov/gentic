import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "@gentic/services/errors"

import { createHostEnrollmentCodeHandler } from "../app/api/app/hosts/enrollment-code/route"
import {
  createHostExchangeHandler,
  rateLimitKeyFromRequest,
} from "../app/api/v1/hosts/exchange/route"

test("host enrollment code route requires an authenticated user", async () => {
  const handler = createHostEnrollmentCodeHandler({
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

test("host enrollment code route creates a single-use code for the authenticated user", async () => {
  const supabase = {}
  const handler = createHostEnrollmentCodeHandler({
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

test("host enrollment code route maps service validation errors", async () => {
  const handler = createHostEnrollmentCodeHandler({
    getContext: async () => ({ supabase: {}, userId: "user_1" }) as never,
    createCode: async () => {
      throw new ServiceError(
        "validation",
        "Host enrollment code already exists"
      )
    },
  })

  const response = await handler()

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), {
    error: "Host enrollment code already exists",
  })
})

test("host exchange route returns the raw credential on successful exchange", async () => {
  const supabase = {}
  const originalApiUrl = process.env.GENTIC_PUBLIC_API_URL
  process.env.GENTIC_PUBLIC_API_URL = "https://hosts.example/api/v1/"
  let capturedRateLimitKey: string | undefined
  const handler = createHostExchangeHandler({
    createSupabase: () => supabase as never,
    exchange: async (actualSupabase, body, options) => {
      assert.equal(actualSupabase, supabase)
      assert.deepEqual(body, { code: "gtce_connection-code" })
      assert.ok(options)
      capturedRateLimitKey = options.rateLimitKey
      return {
        credential: "gtwc_host-credential",
        host: {
          id: "host-1",
          display_name: "Build Host",
          setup_state: "enrolling",
        },
      } as never
    },
  })

  try {
    const response = await handler(
      new Request("http://localhost/api/v1/hosts/exchange", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.7, 10.0.0.1",
          "x-vercel-forwarded-for": "203.0.113.7",
          "user-agent": "gentic-test",
        },
        body: JSON.stringify({ code: "gtce_connection-code" }),
      })
    )

    assert.equal(response.status, 200)
    assert.equal(capturedRateLimitKey, "203.0.113.7")
    assert.deepEqual(await response.json(), {
      api_url: "https://hosts.example/api/v1",
      host: {
        id: "host-1",
        display_name: "Build Host",
        setup_state: "enrolling",
      },
      credential: "gtwc_host-credential",
    })
  } finally {
    if (originalApiUrl === undefined) delete process.env.GENTIC_PUBLIC_API_URL
    else process.env.GENTIC_PUBLIC_API_URL = originalApiUrl
  }
})

test("host exchange route falls back to the right-most forwarded-for hop", () => {
  assert.equal(
    rateLimitKeyFromRequest(
      new Request("http://localhost/api/v1/hosts/exchange", {
        headers: {
          "x-forwarded-for": "198.51.100.7, 10.0.0.1",
          "x-real-ip": "192.0.2.5",
          "user-agent": "gentic-test",
        },
      })
    ),
    "10.0.0.1"
  )
})

test("host exchange route keeps failures non-enumerable", async () => {
  const handler = createHostExchangeHandler({
    createSupabase: () => ({}) as never,
    exchange: async () => {
      throw new ServiceError("validation", "expired")
    },
  })

  const response = await handler(
    new Request("http://localhost/api/v1/hosts/exchange", {
      method: "POST",
      body: JSON.stringify({ code: "gtce_expired" }),
    })
  )

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), {
    error: "Invalid enrollment code",
  })
})

test("host exchange route maps lockouts to non-enumerable rate limits", async () => {
  const handler = createHostExchangeHandler({
    createSupabase: () => ({}) as never,
    exchange: async () => {
      throw new ServiceError("rate_limited", "Invalid enrollment code")
    },
  })

  const response = await handler(
    new Request("http://localhost/api/v1/hosts/exchange", {
      method: "POST",
      body: JSON.stringify({ code: "gtce_locked" }),
    })
  )

  assert.equal(response.status, 429)
  assert.deepEqual(await response.json(), {
    error: "Invalid enrollment code",
  })
})
