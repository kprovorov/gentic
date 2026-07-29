import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, test } from "node:test"

import {
  captureGitBaseline,
  hasLocalCheckout,
  hasRepositoryChangesSinceBaseline,
} from "./git.js"

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

test("hasRepositoryChangesSinceBaseline is false for unchanged repositories", async () => {
  initRepo(dir)
  const baseline = await captureGitBaseline(dir)

  assert.equal(await hasRepositoryChangesSinceBaseline(dir, baseline), false)
})

test("hasRepositoryChangesSinceBaseline detects dirty files", async () => {
  initRepo(dir)
  const baseline = await captureGitBaseline(dir)

  await writeFile(join(dir, "tracked.txt"), "changed\n")

  assert.equal(await hasRepositoryChangesSinceBaseline(dir, baseline), true)
})

test("hasRepositoryChangesSinceBaseline detects untracked files", async () => {
  initRepo(dir)
  const baseline = await captureGitBaseline(dir)

  await writeFile(join(dir, "untracked.txt"), "new\n")

  assert.equal(await hasRepositoryChangesSinceBaseline(dir, baseline), true)
})

test("hasRepositoryChangesSinceBaseline detects commits after baseline", async () => {
  initRepo(dir)
  const baseline = await captureGitBaseline(dir)

  await writeFile(join(dir, "tracked.txt"), "changed\n")
  git(dir, "add", "tracked.txt")
  git(dir, "commit", "-m", "test: change tracked file")

  assert.equal(await hasRepositoryChangesSinceBaseline(dir, baseline), true)
})

function initRepo(repoDir: string): void {
  git(repoDir, "init", "--initial-branch=main")
  git(repoDir, "config", "user.email", "test@example.com")
  git(repoDir, "config", "user.name", "Test User")
  execFileSync("git", ["-C", repoDir, "commit", "--allow-empty", "-m", "init"])
  execFileSync("git", ["-C", repoDir, "status", "--short"])
}

function git(repoDir: string, ...args: string[]): void {
  execFileSync("git", ["-C", repoDir, ...args], { stdio: "ignore" })
}
