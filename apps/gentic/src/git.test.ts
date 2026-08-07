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
  checkoutIssueBranch,
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

test("checkoutIssueBranch resumes a canonical remote branch without a PR URL", async () => {
  const remote = join(dir, "remote.git")
  const source = join(dir, "source")
  const checkout = join(dir, "checkout")
  mkdirSync(source)
  execFileSync("git", ["init", "--bare", "-q", remote])
  execFileSync("git", ["init", "-q"], { cwd: source })
  execFileSync("git", ["config", "user.email", "gentic-test@example.com"], {
    cwd: source,
  })
  execFileSync("git", ["config", "user.name", "Gentic Test"], {
    cwd: source,
  })
  writeFileSync(join(source, "README.md"), "default\n")
  execFileSync("git", ["add", "README.md"], { cwd: source })
  execFileSync("git", ["commit", "-q", "-m", "initial"], { cwd: source })
  execFileSync("git", ["branch", "-M", "main"], { cwd: source })
  execFileSync("git", ["remote", "add", "origin", remote], { cwd: source })
  execFileSync("git", ["push", "-q", "-u", "origin", "main"], {
    cwd: source,
  })
  execFileSync("git", ["switch", "-q", "-c", "gen-42-fix-the-thing"], {
    cwd: source,
  })
  writeFileSync(join(source, "README.md"), "issue branch\n")
  execFileSync("git", ["commit", "-q", "-am", "issue work"], {
    cwd: source,
  })
  execFileSync("git", ["push", "-q", "origin", "gen-42-fix-the-thing"], {
    cwd: source,
  })
  execFileSync("git", ["clone", "-q", "--branch", "main", remote, checkout])

  assert.equal(
    await checkoutIssueBranch({
      branchName: "gen-42-fix-the-thing",
      dir: checkout,
    }),
    true
  )
  assert.equal(
    execFileSync("git", ["branch", "--show-current"], {
      cwd: checkout,
      encoding: "utf8",
    }).trim(),
    "gen-42-fix-the-thing"
  )
  assert.equal(
    await checkoutIssueBranch({ branchName: "gen-42-missing", dir: checkout }),
    false
  )
  assert.equal(
    execFileSync("git", ["branch", "--show-current"], {
      cwd: checkout,
      encoding: "utf8",
    }).trim(),
    "gen-42-fix-the-thing"
  )
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
