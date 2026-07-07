import assert from "node:assert/strict"
import { test } from "node:test"

import { resolveGenticExecutable } from "./entry.js"

test("resolveGenticExecutable keeps the script path for Node execution", () => {
  assert.deepEqual(
    resolveGenticExecutable({
      execPath: "/usr/bin/node",
      argv: ["/usr/bin/node", "/opt/gentic/dist/cli.js", "start"],
    }),
    {
      command: "/usr/bin/node",
      args: ["/opt/gentic/dist/cli.js"],
    },
  )
})

test("resolveGenticExecutable omits Bun's virtual embedded entry path", () => {
  assert.deepEqual(
    resolveGenticExecutable({
      execPath: "/opt/gentic/gentic",
      argv: ["/opt/gentic/gentic", "/$bunfs/root/gentic", "start"],
    }),
    {
      command: "/opt/gentic/gentic",
      args: [],
    },
  )
})

test("resolveGenticExecutable requires an entry point for non-embedded runtimes", () => {
  assert.throws(
    () =>
      resolveGenticExecutable({
        execPath: "/usr/bin/node",
        argv: ["/usr/bin/node"],
      }),
    /Unable to resolve/,
  )
})
