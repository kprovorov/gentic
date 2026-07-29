import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, rm } from "node:fs/promises"
import { dirname, join } from "node:path"

import { spawnInteractive } from "./installers.js"

/** Whether `dir` already holds a git checkout, e.g. from an earlier run. */
export function hasLocalCheckout(dir: string): boolean {
  return existsSync(join(dir, ".git"))
}

/**
 * Clones a project repo into a fresh directory. Any existing directory at
 * `dir` is removed first so each run starts from a clean checkout.
 *
 * `remoteBase` is prepended to `repo`, e.g. base `git@github.com:` and repo
 * `owner/repo` clone `git@github.com:owner/repo`.
 */
export async function cloneRepo(options: {
  remoteBase: string
  repo: string
  dir: string
}): Promise<void> {
  const remote = `${options.remoteBase}${options.repo}`
  await rm(options.dir, { recursive: true, force: true })
  await mkdir(dirname(options.dir), { recursive: true })
  await run("git", ["clone", "--depth", "1", remote, options.dir])
}

/**
 * Checks out the branch for an existing pull request so follow-up runs can
 * update that PR instead of creating a second one. Returns false when GitHub
 * can no longer check out the branch, e.g. after the PR was merged and the
 * branch was deleted.
 */
export async function checkoutPullRequest(options: {
  prUrl: string
  dir: string
}): Promise<boolean> {
  try {
    await run("gh", ["pr", "checkout", options.prUrl], { cwd: options.dir })
    return true
  } catch {
    return false
  }
}

/**
 * Runs a project's configured setup script (e.g. `npm install`) in the
 * cloned repo before the agent session starts.
 */
export async function runSetupScript(options: {
  script: string
  dir: string
}): Promise<void> {
  await run("sh", ["-c", options.script], { cwd: options.dir })
}

/**
 * Looks up the URL of the pull request open for the current branch of the
 * cloned repo, if the agent created one during its run. Returns `null` when
 * there is no such PR (e.g. the agent made no changes).
 */
export async function getPullRequestUrl(dir: string): Promise<string | null> {
  try {
    const output = await runCapture(
      "gh",
      ["pr", "view", "--json", "url", "-q", ".url"],
      { cwd: dir }
    )
    const url = output.trim()
    return url.length > 0 ? url : null
  } catch {
    return null
  }
}

/** Snapshot of a repo's commit history, taken once repository setup has finished. */
export interface RepoBaseline {
  headSha: string
  worktreeFingerprint: string
}

/**
 * Records the repo's current commit so a later check can tell whether the
 * agent changed anything afterward, as distinct from changes the clone or
 * the project's setup script already introduced. Call this once, right after
 * `runSetupScript` (or right after `cloneRepo` when there is no setup
 * script), before handing the repo to the agent.
 */
export async function captureRepoBaseline(dir: string): Promise<RepoBaseline> {
  const headSha = await runCapture("git", ["rev-parse", "HEAD"], { cwd: dir })
  const worktreeFingerprint = await captureWorktreeFingerprint(dir)
  return { headSha: headSha.trim(), worktreeFingerprint }
}

/**
 * True when the working tree has uncommitted modifications or untracked
 * files, i.e. `git status --porcelain` reports anything at all.
 */
export async function hasUncommittedChanges(dir: string): Promise<boolean> {
  const status = await runCapture("git", ["status", "--porcelain"], {
    cwd: dir,
  })
  return status.trim().length > 0
}

/** True when HEAD has moved past `baseline`, i.e. new commits were made. */
export async function hasNewCommitsSince(
  dir: string,
  baseline: RepoBaseline
): Promise<boolean> {
  const headSha = await runCapture("git", ["rev-parse", "HEAD"], { cwd: dir })
  return headSha.trim() !== baseline.headSha
}

/**
 * True when the repo has any change relative to `baseline`: an uncommitted
 * or untracked change in the working tree, or a new commit on HEAD. Used to
 * decide whether an issue run actually produced anything worth publishing.
 */
export async function hasChangesSinceBaseline(
  dir: string,
  baseline: RepoBaseline
): Promise<boolean> {
  const worktreeFingerprint = await captureWorktreeFingerprint(dir)
  if (worktreeFingerprint !== baseline.worktreeFingerprint) {
    return true
  }
  return hasNewCommitsSince(dir, baseline)
}

async function captureWorktreeFingerprint(dir: string): Promise<string> {
  const [status, unstagedDiff, stagedDiff, untrackedFilesOutput] =
    await Promise.all([
      runCapture("git", ["status", "--porcelain=v1", "-z"], { cwd: dir }),
      runCapture("git", ["diff", "--binary"], { cwd: dir }),
      runCapture("git", ["diff", "--cached", "--binary"], { cwd: dir }),
      runCapture("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
        cwd: dir,
      }),
    ])
  const hash = createHash("sha256")
  hash.update(status)
  hash.update("\0")
  hash.update(unstagedDiff)
  hash.update("\0")
  hash.update(stagedDiff)
  hash.update("\0")

  const untrackedFiles = untrackedFilesOutput
    .split("\0")
    .filter((file) => file.length > 0)
    .sort()
  for (const file of untrackedFiles) {
    hash.update(file)
    hash.update("\0")
    hash.update(await readFile(join(dir, file)))
    hash.update("\0")
  }

  return hash.digest("hex")
}

function run(
  command: string,
  args: string[],
  options: { cwd?: string } = {}
): Promise<void> {
  return spawnInteractive(command, args, options)
}

function runCapture(
  command: string,
  args: string[],
  options: { cwd?: string } = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "inherit"],
      cwd: options.cwd,
    })
    let stdout = ""
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`))
      }
    })
  })
}
