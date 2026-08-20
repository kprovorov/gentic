import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
  cloneRepoAtSha,
  diffAgainstBase,
  hasChangesSinceBaseline,
  hasLocalCheckout,
  hasNewCommitsSince,
  hasUncommittedChanges,
  verifyHeadSha,
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

describe("exact-SHA checkout (GEN-415 isolated reviewer)", () => {
  let remote: string
  let source: string
  let baseSha: string
  let headSha: string

  beforeEach(() => {
    remote = join(dir, "remote.git")
    source = join(dir, "source")
    mkdirSync(source)
    execFileSync("git", ["init", "--bare", "-q", remote])
    // Fetching an arbitrary commit SHA (not just a branch tip) requires this
    // on the server side — GitHub enables it account-wide already, so this
    // mirrors production rather than working around a local-only quirk.
    execFileSync("git", [
      "config",
      "--file",
      join(remote, "config"),
      "uploadpack.allowReachableSHA1InWant",
      "true",
    ])
    execFileSync("git", ["init", "-q"], { cwd: source })
    execFileSync("git", ["config", "user.email", "gentic-test@example.com"], {
      cwd: source,
    })
    execFileSync("git", ["config", "user.name", "Gentic Test"], {
      cwd: source,
    })
    writeFileSync(join(source, "README.md"), "base\n")
    execFileSync("git", ["add", "README.md"], { cwd: source })
    execFileSync("git", ["commit", "-q", "-m", "base commit"], { cwd: source })
    execFileSync("git", ["branch", "-M", "main"], { cwd: source })
    execFileSync("git", ["remote", "add", "origin", remote], { cwd: source })
    execFileSync("git", ["push", "-q", "-u", "origin", "main"], {
      cwd: source,
    })
    baseSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: source,
      encoding: "utf8",
    }).trim()

    writeFileSync(join(source, "README.md"), "head\n")
    execFileSync("git", ["commit", "-q", "-am", "head commit"], {
      cwd: source,
    })
    execFileSync("git", ["push", "-q", "origin", "main"], { cwd: source })
    headSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: source,
      encoding: "utf8",
    }).trim()
  })

  test("cloneRepoAtSha checks out exactly the requested commit, detached", async () => {
    const checkout = join(dir, "checkout")
    await cloneRepoAtSha({
      remoteBase: `${dir}/`,
      repo: "remote.git",
      sha: headSha,
      dir: checkout,
    })

    assert.equal(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: checkout,
        encoding: "utf8",
      }).trim(),
      headSha
    )
    assert.equal(
      execFileSync("git", ["branch", "--show-current"], {
        cwd: checkout,
        encoding: "utf8",
      }).trim(),
      "",
      "HEAD is detached, not on a branch"
    )
    assert.equal(
      readFileSync(join(checkout, "README.md"), "utf8"),
      "head\n"
    )
  })

  test("cloneRepoAtSha pins to an older SHA, not the branch tip", async () => {
    const checkout = join(dir, "checkout")
    await cloneRepoAtSha({
      remoteBase: `${dir}/`,
      repo: "remote.git",
      sha: baseSha,
      dir: checkout,
    })

    assert.equal(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: checkout,
        encoding: "utf8",
      }).trim(),
      baseSha
    )
    assert.equal(readFileSync(join(checkout, "README.md"), "utf8"), "base\n")
  })

  test("verifyHeadSha resolves for a matching checkout", async () => {
    const checkout = join(dir, "checkout")
    await cloneRepoAtSha({
      remoteBase: `${dir}/`,
      repo: "remote.git",
      sha: headSha,
      dir: checkout,
    })

    await assert.doesNotReject(verifyHeadSha(checkout, headSha))
  })

  test("verifyHeadSha throws on a mismatched SHA", async () => {
    const checkout = join(dir, "checkout")
    await cloneRepoAtSha({
      remoteBase: `${dir}/`,
      repo: "remote.git",
      sha: headSha,
      dir: checkout,
    })

    await assert.rejects(
      verifyHeadSha(checkout, baseSha),
      /does not match the requested review SHA/
    )
  })

  test("diffAgainstBase returns the diff between the base and head commits", async () => {
    const checkout = join(dir, "checkout")
    await cloneRepoAtSha({
      remoteBase: `${dir}/`,
      repo: "remote.git",
      sha: headSha,
      dir: checkout,
    })

    const diff = await diffAgainstBase({ dir: checkout, baseSha, headSha })
    assert.match(diff, /-base/)
    assert.match(diff, /\+head/)
  })
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
