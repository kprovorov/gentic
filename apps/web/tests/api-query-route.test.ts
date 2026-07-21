import assert from "node:assert/strict"
import test from "node:test"

import {
  apiQueryNoStoreHeaders,
  createJsonQueryHandler,
} from "../app/api/app/api-query-route"

test("API query route returns 401 when no authenticated context exists", async () => {
  const handler = createJsonQueryHandler(
    async () => ({ ok: true }),
    {
      getContext: async () => null,
      isNotFoundError: () => false,
    }
  )

  const response = await handler(new Request("http://localhost/api/app/home"))

  assert.equal(response.status, 401)
  assert.equal(
    response.headers.get("Cache-Control"),
    apiQueryNoStoreHeaders["Cache-Control"]
  )
  assert.deepEqual(await response.json(), {
    error: { code: "unauthorized", message: "Unauthorized" },
  })
})

test("API query route passes params to authenticated reads", async () => {
  const handler = createJsonQueryHandler(
    async ({ context, params }) => ({ context, params }),
    {
      getContext: async () => ({ userId: "user_1" }),
      isNotFoundError: () => false,
    }
  )

  const response = await handler(new Request("http://localhost"), {
    params: Promise.resolve({ id: "issue_1" }),
  })

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    context: { userId: "user_1" },
    params: { id: "issue_1" },
  })
})

test("API query route maps scoped missing records to 404", async () => {
  class NotFound extends Error {}

  const handler = createJsonQueryHandler(
    async () => {
      throw new NotFound("Issue not found")
    },
    {
      getContext: async () => ({ userId: "user_1" }),
      isNotFoundError: (error) => error instanceof NotFound,
    }
  )

  const response = await handler(new Request("http://localhost"))

  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), {
    error: { code: "not_found", message: "Issue not found" },
  })
})
