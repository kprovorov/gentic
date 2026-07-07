import assert from "node:assert/strict"
import { test } from "node:test"

import { buildServicePath } from "./env.js"

test("buildServicePath preserves install-time PATH and adds common package manager paths", () => {
  const path = buildServicePath("/custom/bin:/usr/bin:/custom/bin", "/Users/alice")

  assert.equal(
    path,
    [
      "/custom/bin",
      "/usr/bin",
      "/Users/alice/.local/share/pnpm",
      "/Users/alice/.local/bin",
      "/Users/alice/Library/pnpm",
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ].join(":"),
  )
})
