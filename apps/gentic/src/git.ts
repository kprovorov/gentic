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
 * Runs a project's configured setup script (e.g. `npm install`) in the
 * cloned repo before the agent session starts.
 */
export async function runSetupScript(options: {
  script: string
  dir: string
}): Promise<void> {
  await run("sh", ["-c", options.script], { cwd: options.dir })
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
