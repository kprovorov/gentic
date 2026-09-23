import assert from "node:assert/strict"
import { test } from "node:test"

import {
  claimHostToolUpdateResponseSchema,
  createHostToolUpdateInputSchema,
  HOST_TOOLS,
  hostToolUpdateTerminalStatusSchema,
  reportHostToolUpdateResultInputSchema,
  sanitizeHostToolUpdateOutput,
} from "./host-tool-updates.js"

test("exactly the four host tools can be requested", () => {
  assert.deepEqual(HOST_TOOLS, ["gentic", "claude_code", "codex", "github"])
  assert.deepEqual(createHostToolUpdateInputSchema.parse({ tool: "github" }), {
    tool: "github",
  })
  assert.throws(() => createHostToolUpdateInputSchema.parse({ tool: "gh" }))
  assert.throws(() =>
    createHostToolUpdateInputSchema.parse({ tool: "codex", extra: true })
  )
})

test("a host may only report a terminal outcome", () => {
  assert.deepEqual(
    reportHostToolUpdateResultInputSchema.parse({
      status: "updated",
      summary: "Updated to 2.1.0",
      version: "2.1.0",
    }),
    { status: "updated", summary: "Updated to 2.1.0", version: "2.1.0" }
  )
  assert.throws(() =>
    reportHostToolUpdateResultInputSchema.parse({ status: "updating" })
  )
  assert.throws(() =>
    reportHostToolUpdateResultInputSchema.parse({ status: "timed-out" })
  )
  assert.throws(() =>
    reportHostToolUpdateResultInputSchema.parse({
      status: "failed",
      version: "",
    })
  )
  assert.deepEqual(hostToolUpdateTerminalStatusSchema.options, [
    "updated",
    "failed",
  ])
})

test("the claim response is either one command or nothing", () => {
  assert.deepEqual(claimHostToolUpdateResponseSchema.parse({ command: null }), {
    command: null,
  })
  const command = {
    id: "55555555-5555-4555-8555-555555555555",
    tool: "gentic",
    expires_at: "2026-09-23T12:30:00.000Z",
  }
  assert.deepEqual(claimHostToolUpdateResponseSchema.parse({ command }), {
    command,
  })
  assert.throws(() =>
    claimHostToolUpdateResponseSchema.parse({
      command: { ...command, steps: [] },
    })
  )
})

test("update output is scrubbed like skill install output", () => {
  assert.equal(
    sanitizeHostToolUpdateOutput(
      "npm notice added 3 packages in /home/ada/.npm NPM_TOKEN=npm_abcdefghijklmnopqrstu"
    ),
    "npm notice added 3 packages in ~/.npm NPM_TOKEN=[redacted]"
  )
})
