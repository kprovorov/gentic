import { spawn } from "node:child_process"
import { closeSync, existsSync, openSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { setTimeout as sleep } from "node:timers/promises"
import { join } from "node:path"

import envPaths from "env-paths"

import { resolveGenticExecutable } from "./entry.js"
import type { ServiceBackend, ServiceInstallOptions, ServiceLogsOptions, ServiceStatus } from "./types.js"

const paths = envPaths("gentic", { suffix: "" })
const PID_FILE = join(paths.data, "gentic.pid")
const LOG_FILE = join(paths.log, "gentic.log")

async function readPid(): Promise<number | undefined> {
  if (!existsSync(PID_FILE)) return undefined
  const contents = (await readFile(PID_FILE, "utf8")).trim()
  const pid = Number(contents)
  return Number.isInteger(pid) && pid > 0 ? pid : undefined
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForExit(pid: number, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (isAlive(pid) && Date.now() - start < timeoutMs) {
    await sleep(200)
  }
}

/**
 * Best-effort supervision for platforms with no native service manager: a
 * detached child process plus a pidfile. Unlike the systemd/launchd backends,
 * this cannot restart the process on crash or start it on boot.
 */
export class FallbackBackend implements ServiceBackend {
  readonly name = "fallback"

  isAvailable(): boolean {
    return true
  }

  async install(opts: ServiceInstallOptions): Promise<void> {
    if (opts.enableOnBoot) {
      throw new Error(
        "No native service manager (systemd or launchd) was found on this platform, " +
          "so gentic falls back to a detached background process. This mode does not " +
          "survive a reboot and will not auto-restart on crash; boot-on-start isn't " +
          "available here.",
      )
    }
    await this.start()
  }

  async uninstall(): Promise<void> {
    await this.stop()
  }

  async start(): Promise<void> {
    const existingPid = await readPid()
    if (existingPid && isAlive(existingPid)) return
    if (existingPid) await rm(PID_FILE, { force: true })

    await mkdir(paths.data, { recursive: true })
    await mkdir(paths.log, { recursive: true })

    const { command, entry } = resolveGenticExecutable()
    const logFd = openSync(LOG_FILE, "a")
    const child = spawn(command, [entry, "run"], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
    })
    closeSync(logFd)
    child.unref()

    if (!child.pid) {
      throw new Error("Failed to spawn the detached gentic process")
    }

    await writeFile(PID_FILE, String(child.pid), "utf8")
  }

  async stop(): Promise<void> {
    const pid = await readPid()
    if (!pid) return

    if (isAlive(pid)) {
      process.kill(pid, "SIGTERM")
      await waitForExit(pid, 5000)
      if (isAlive(pid)) process.kill(pid, "SIGKILL")
    }

    await rm(PID_FILE, { force: true })
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  async status(): Promise<ServiceStatus> {
    const pid = await readPid()
    if (!pid) return { state: "not-installed" }

    if (!isAlive(pid)) {
      await rm(PID_FILE, { force: true })
      return { state: "not-installed" }
    }

    return { state: "running", pid }
  }

  isEnabledOnBoot(): Promise<boolean> {
    return Promise.resolve(false)
  }

  async logs(opts: ServiceLogsOptions): Promise<void> {
    if (!existsSync(LOG_FILE)) {
      throw new Error(`No log file found at ${LOG_FILE}`)
    }

    const args = opts.follow ? ["-f", LOG_FILE] : ["-n", "200", LOG_FILE]
    await new Promise<void>((resolve, reject) => {
      const child = spawn("tail", args, { stdio: "inherit" })
      child.on("error", reject)
      child.on("exit", (code) => {
        if (code === 0 || code === null) resolve()
        else reject(new Error(`tail exited with code ${code}`))
      })
    })
  }
}
