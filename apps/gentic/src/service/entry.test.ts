import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

import { resolveGenticExecutable, stableExecutablePath } from "./entry.js"

// Simulate a package-manager layout: the real binary lives in a versioned
// keg directory and a stable bin/ symlink on PATH points at it.
const root = mkdtempSync(join(tmpdir(), "gentic-entry-test-"))
const kegDir = join(root, "Cellar", "gentic", "0.5.0", "libexec")
const binDir = join(root, "bin")
const kegBinary = join(kegDir, "gentic")
const binSymlink = join(binDir, "gentic")
mkdirSync(kegDir, { recursive: true })
mkdirSync(binDir, { recursive: true })
writeFileSync(kegBinary, "#!/bin/sh\n", { mode: 0o755 })
symlinkSync(kegBinary, binSymlink)

after(() => rmSync(root, { recursive: true, force: true }))

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
      env: { PATH: "/usr/bin:/bin" },
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

test("stableExecutablePath prefers the PATH symlink over the versioned real path", () => {
  assert.equal(stableExecutablePath(kegBinary, `/usr/bin:${binDir}`), binSymlink)
})

test("stableExecutablePath keeps execPath when nothing on PATH resolves to it", () => {
  const otherDir = join(root, "other-bin")
  mkdirSync(otherDir, { recursive: true })
  writeFileSync(join(otherDir, "gentic"), "#!/bin/sh\n", { mode: 0o755 })
  assert.equal(stableExecutablePath(kegBinary, `${otherDir}:/nonexistent`), kegBinary)
})

test("stableExecutablePath ignores relative PATH entries", () => {
  assert.equal(stableExecutablePath(kegBinary, "bin:."), kegBinary)
})

test("stableExecutablePath keeps a missing execPath untouched", () => {
  const missing = join(root, "gone", "gentic")
  assert.equal(stableExecutablePath(missing, binDir), missing)
})

test("resolveGenticExecutable stabilizes the Bun binary path via PATH", () => {
  assert.deepEqual(
    resolveGenticExecutable({
      execPath: realpathSync(kegBinary),
      argv: [kegBinary, "/$bunfs/root/gentic", "start"],
      env: { PATH: binDir },
    }),
    {
      command: binSymlink,
      args: [],
    },
  )
})
