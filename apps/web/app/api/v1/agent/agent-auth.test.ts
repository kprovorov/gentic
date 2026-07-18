import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { test } from "node:test"

test("temporary agent API key bypass is explicit and production-gated", async () => {
  const authHelper = await readFile(
    new URL("./_lib.ts", import.meta.url),
    "utf8"
  )
  const envExample = await readFile(
    new URL("../../../../.env.example", import.meta.url),
    "utf8"
  )

  assert.match(authHelper, /SPECIAL_TEST_API_KEY_ENABLED.*=== "true"/)
  assert.match(authHelper, /NODE_ENV.*=== "production"/)
  assert.match(authHelper, /VERCEL_ENV.*=== "production"/)
  assert.match(authHelper, /SPECIAL_TEST_USER_ID\.startsWith\("user_"\)/)
  assert.match(authHelper, /clerk\.apiKeys\.verify\(token\)/)

  assert.match(envExample, /SPECIAL_TEST_API_KEY_ENABLED=false/)
  assert.match(envExample, /ignored in production/)
})
