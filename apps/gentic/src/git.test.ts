import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, test } from "node:test"

import { hasLocalCheckout } from "./git.js"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gentic-git-test-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

test("hasLocalCheckout is false for a directory with no .git", () => {
  assert.equal(hasLocalCheckout(dir), false)
})

test("hasLocalCheckout is false for a directory that doesn't exist", () => {
  assert.equal(hasLocalCheckout(join(dir, "missing")), false)
})

test("hasLocalCheckout is true once a .git directory is present", () => {
  mkdirSync(join(dir, ".git"))
  assert.equal(hasLocalCheckout(dir), true)
})
