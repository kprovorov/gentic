import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, test } from "node:test"

import {
  captureRepoBaseline,
  hasChangesSinceBaseline,
  hasLocalCheckout,
  hasNewCommitsSince,
  hasUncommittedChanges,
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

describe("repo baseline helpers", () => {
  function git(...args: string[]): void {
    execFileSync("git", args, { cwd: dir, stdio: "ignore" })
  }

  function initRepoWithCommit(): void {
    git("init", "-q")
    git("config", "user.email", "gentic-test@example.com")
    git("config", "user.name", "Gentic Test")
    writeFileSync(join(dir, "README.md"), "hello\n")
    git("add", "README.md")
    git("commit", "-q", "-m", "initial commit")
  }

  test("hasUncommittedChanges is false for a clean repo", async () => {
    initRepoWithCommit()
    assert.equal(await hasUncommittedChanges(dir), false)
  })

  test("hasUncommittedChanges is true for a modified tracked file", async () => {
    initRepoWithCommit()
    writeFileSync(join(dir, "README.md"), "changed\n")
    assert.equal(await hasUncommittedChanges(dir), true)
  })

  test("hasUncommittedChanges is true for an untracked file", async () => {
    initRepoWithCommit()
    writeFileSync(join(dir, "new-file.txt"), "new\n")
    assert.equal(await hasUncommittedChanges(dir), true)
  })

  test("hasNewCommitsSince is false when HEAD hasn't moved", async () => {
    initRepoWithCommit()
    const baseline = await captureRepoBaseline(dir)
    assert.equal(await hasNewCommitsSince(dir, baseline), false)
  })

  test("hasNewCommitsSince is true once a new commit lands", async () => {
    initRepoWithCommit()
    const baseline = await captureRepoBaseline(dir)
    writeFileSync(join(dir, "README.md"), "changed\n")
    git("commit", "-q", "-am", "second commit")
    assert.equal(await hasNewCommitsSince(dir, baseline), true)
  })

  test("hasChangesSinceBaseline is false for an unchanged repo", async () => {
    initRepoWithCommit()
    const baseline = await captureRepoBaseline(dir)
    assert.equal(await hasChangesSinceBaseline(dir, baseline), false)
  })

  test("hasChangesSinceBaseline is true for a dirty working tree", async () => {
    initRepoWithCommit()
    const baseline = await captureRepoBaseline(dir)
    writeFileSync(join(dir, "untracked.txt"), "new\n")
    assert.equal(await hasChangesSinceBaseline(dir, baseline), true)
  })

  test("hasChangesSinceBaseline ignores dirty files present at baseline", async () => {
    initRepoWithCommit()
    writeFileSync(join(dir, "setup-output.txt"), "created by setup\n")
    const baseline = await captureRepoBaseline(dir)

    assert.equal(await hasChangesSinceBaseline(dir, baseline), false)
  })

  test("hasChangesSinceBaseline detects changes to dirty files after baseline", async () => {
    initRepoWithCommit()
    writeFileSync(join(dir, "setup-output.txt"), "created by setup\n")
    const baseline = await captureRepoBaseline(dir)
    writeFileSync(join(dir, "setup-output.txt"), "changed by agent\n")

    assert.equal(await hasChangesSinceBaseline(dir, baseline), true)
  })

  test("hasChangesSinceBaseline treats unreadable untracked files as changes", async () => {
    initRepoWithCommit()
    symlinkSync("missing-target.txt", join(dir, "broken-link.txt"))
    const baseline = await captureRepoBaseline(dir)

    assert.equal(await hasChangesSinceBaseline(dir, baseline), true)
  })

  test("hasChangesSinceBaseline is true once a new commit lands", async () => {
    initRepoWithCommit()
    const baseline = await captureRepoBaseline(dir)
    writeFileSync(join(dir, "README.md"), "changed\n")
    git("commit", "-q", "-am", "second commit")
    assert.equal(await hasChangesSinceBaseline(dir, baseline), true)
  })
})
