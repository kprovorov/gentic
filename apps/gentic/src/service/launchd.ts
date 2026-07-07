import { execFile as execFileCb, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { buildServicePath } from "./env.js"
import { resolveGenticExecutable } from "./entry.js"
import type { ServiceBackend, ServiceInstallOptions, ServiceLogsOptions, ServiceStatus } from "./types.js"

const execFile = promisify(execFileCb)

const LABEL = "dev.gentic.agent"

function plistPath(): string {
  return join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`)
}

function logPath(): string {
  return join(homedir(), "Library", "Logs", "gentic", "gentic.log")
}

function domainTarget(): string {
  return `gui/${process.getuid?.() ?? 0}`
}

function serviceTarget(): string {
  return `${domainTarget()}/${LABEL}`
}

function describe(error: unknown): string {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = (error as { stderr?: string }).stderr
    if (stderr && stderr.trim().length > 0) return stderr.trim()
  }
  return error instanceof Error ? error.message : String(error)
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

export class LaunchdBackend implements ServiceBackend {
  readonly name = "launchd"

  isAvailable(): boolean {
    return process.platform === "darwin"
  }

  private plistContents(enableOnBoot: boolean): string {
    const { command, args } = resolveGenticExecutable()
    const log = logPath()
    const path = buildServicePath()
    const programArguments = [command, ...args, "run"]
      .map((arg) => `    <string>${escapeXml(arg)}</string>`)
      .join("\n")
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${escapeXml(path)}</string>
  </dict>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><${enableOnBoot ? "true" : "false"}/>
  <key>StandardOutPath</key><string>${escapeXml(log)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(log)}</string>
</dict>
</plist>
`
  }

  private async isLoaded(): Promise<boolean> {
    try {
      await execFile("launchctl", ["print", serviceTarget()])
      return true
    } catch {
      return false
    }
  }

  async install(opts: ServiceInstallOptions): Promise<void> {
    await mkdir(join(homedir(), "Library", "LaunchAgents"), { recursive: true })
    await mkdir(join(homedir(), "Library", "Logs", "gentic"), { recursive: true })
    await writeFile(plistPath(), this.plistContents(opts.enableOnBoot), "utf8")

    if (await this.isLoaded()) {
      await execFile("launchctl", ["bootout", serviceTarget()]).catch(() => undefined)
    }

    try {
      await execFile("launchctl", ["bootstrap", domainTarget(), plistPath()])
    } catch (error) {
      throw new Error(`launchctl bootstrap failed: ${describe(error)}`)
    }
  }

  async uninstall(): Promise<void> {
    if (!existsSync(plistPath())) return
    await execFile("launchctl", ["bootout", serviceTarget()]).catch(() => undefined)
    await rm(plistPath(), { force: true })
  }

  async start(): Promise<void> {
    if (!existsSync(plistPath())) {
      throw new Error("gentic service is not installed; run `gentic start` to install it")
    }

    if (await this.isLoaded()) {
      await execFile("launchctl", ["kickstart", serviceTarget()]).catch((error) => {
        throw new Error(`launchctl kickstart failed: ${describe(error)}`)
      })
      return
    }

    try {
      await execFile("launchctl", ["bootstrap", domainTarget(), plistPath()])
    } catch (error) {
      throw new Error(`launchctl bootstrap failed: ${describe(error)}`)
    }
  }

  async stop(): Promise<void> {
    if (!(await this.isLoaded())) return
    try {
      await execFile("launchctl", ["bootout", serviceTarget()])
    } catch (error) {
      throw new Error(`launchctl bootout failed: ${describe(error)}`)
    }
  }

  async restart(): Promise<void> {
    if (await this.isLoaded()) {
      try {
        await execFile("launchctl", ["kickstart", "-k", serviceTarget()])
      } catch (error) {
        throw new Error(`launchctl kickstart failed: ${describe(error)}`)
      }
      return
    }
    await this.start()
  }

  async status(): Promise<ServiceStatus> {
    if (!existsSync(plistPath())) return { state: "not-installed" }

    try {
      const { stdout } = await execFile("launchctl", ["print", serviceTarget()])
      const pidMatch = /^\s*pid = (\d+)/m.exec(stdout)
      const stateMatch = /state = (\S+)/.exec(stdout)
      const running = stateMatch?.[1] === "running"
      return {
        state: running ? "running" : "stopped",
        pid: running && pidMatch ? Number(pidMatch[1]) : undefined,
      }
    } catch {
      return { state: "stopped" }
    }
  }

  async isEnabledOnBoot(): Promise<boolean> {
    if (!existsSync(plistPath())) return false
    const contents = await readFile(plistPath(), "utf8")
    return /<key>RunAtLoad<\/key>\s*<true\/>/.test(contents)
  }

  async logs(opts: ServiceLogsOptions): Promise<void> {
    const log = logPath()
    if (!existsSync(log)) {
      throw new Error(`No log file found at ${log}`)
    }

    const args = opts.follow ? ["-f", log] : ["-n", "200", log]
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
