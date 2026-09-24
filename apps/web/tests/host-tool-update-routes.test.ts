import assert from "node:assert/strict"
import test from "node:test"

import { ServiceError } from "@gentic/services/errors"

import {
  createHostToolUpdateRoute,
  createHostToolUpdatesPollRoute,
} from "../app/api/app/hosts/[id]/tool-updates/route"

const authenticated = async () => ({ supabase: {}, userId: "user_1" }) as never

const params = Promise.resolve({ id: "host-1" })

const waiting = {
  id: "u1",
  host_id: "host-1",
  tool: "github" as const,
  status: "waiting" as const,
  summary: null,
  output: null,
  version: null,
  created_at: "2026-09-23T12:00:00.000Z",
  expires_at: "2026-09-23T12:30:00.000Z",
}

function postRequest(body: unknown) {
  return new Request("https://app.example/api/app/hosts/host-1/tool-updates", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

test("tool update routes reject anonymous callers before touching any state", async () => {
  const routes = [
    createHostToolUpdateRoute({
      getContext: async () => null,
      createUpdate: async () => {
        throw new Error("should not queue an update")
      },
    }),
    createHostToolUpdatesPollRoute({
      getContext: async () => null,
      listUpdates: async () => {
        throw new Error("should not read updates")
      },
    }),
  ]

  for (const route of routes) {
    const response = await route(postRequest({ tool: "github" }), { params })

    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), {
      error: { code: "unauthorized", message: "Unauthorized" },
    })
  }
})

test("queues the requested tool for the host on behalf of the caller", async () => {
  let seen: { userId: string; hostId: string; tool: string } | null = null
  const route = createHostToolUpdateRoute({
    getContext: authenticated,
    createUpdate: async (_supabase, userId, hostId, input) => {
      seen = { userId, hostId, tool: input.tool }
      return waiting
    },
  })

  const response = await route(postRequest({ tool: "github" }), { params })

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), "private, no-store")
  assert.deepEqual(await response.json(), { update: waiting })
  assert.deepEqual(seen, { userId: "user_1", hostId: "host-1", tool: "github" })
})

test("an unknown tool is rejected before the service is called", async () => {
  const route = createHostToolUpdateRoute({
    getContext: authenticated,
    createUpdate: async () => {
      throw new Error("should not queue an update")
    },
  })

  const response = await route(postRequest({ tool: "helm" }), { params })

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), {
    error: { code: "validation", message: "Invalid request" },
  })
})

test("an ineligible host answers 409 with the service's reason", async () => {
  const route = createHostToolUpdateRoute({
    getContext: authenticated,
    createUpdate: async () => {
      throw new ServiceError(
        "conflict",
        "laptop cannot be updated right now (offline)."
      )
    },
  })

  const response = await route(postRequest({ tool: "gentic" }), { params })

  assert.equal(response.status, 409)
  assert.deepEqual(await response.json(), {
    error: {
      code: "conflict",
      message: "laptop cannot be updated right now (offline).",
    },
  })
})

test("the poll route lists the host's updates scoped to the caller", async () => {
  let seen: { userId: string; hostId: string } | null = null
  const route = createHostToolUpdatesPollRoute({
    getContext: authenticated,
    listUpdates: async (_supabase, userId, hostId) => {
      seen = { userId, hostId }
      return [waiting]
    },
  })

  const response = await route(
    new Request("https://app.example/api/app/hosts/host-1/tool-updates"),
    { params }
  )

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { updates: [waiting] })
  assert.deepEqual(seen, { userId: "user_1", hostId: "host-1" })
})
