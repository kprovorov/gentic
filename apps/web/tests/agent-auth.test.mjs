import { readFile } from "node:fs/promises"
import { test } from "node:test"
import assert from "node:assert/strict"

test("agent API authentication has no temporary API-key bypass", async () => {
  const authHelper = await readFile(
    new URL("../app/api/v1/agent/_lib.ts", import.meta.url),
    "utf8"
  )
  const envExample = await readFile(
    new URL("../.env.example", import.meta.url),
    "utf8"
  )

  for (const source of [authHelper, envExample]) {
    assert.equal(source.includes("SPECIAL_TEST_API_KEY"), false)
    assert.equal(source.includes("SPECIAL_TEST_USER_ID"), false)
  }

  assert.match(authHelper, /clerk\.apiKeys\.verify\(token\)/)
})
