import { spawn } from "node:child_process"
import { mkdir, rm } from "node:fs/promises"
import { dirname } from "node:path"

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
 * Checks out the branch for an existing pull request so follow-up runs update
 * that PR instead of creating a second one.
 */
export async function checkoutPullRequest(options: {
  prUrl: string
  dir: string
}): Promise<void> {
  await run("gh", ["pr", "checkout", options.prUrl], { cwd: options.dir })
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

function run(
  command: string,
  args: string[],
  options: { cwd?: string } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "inherit", "inherit"],
      cwd: options.cwd,
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`))
      }
    })
  })
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
