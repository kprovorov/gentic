import { execFile as execFileCb } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { spawnInteractive } from "../installers.js"
import { buildServicePath } from "./env.js"
import { resolveGenticExecutable } from "./entry.js"
import type { ExecFn, ServiceBackend, ServiceInstallOptions, ServiceLogsOptions, ServiceStatus } from "./types.js"

const execFileAsync = promisify(execFileCb)

const defaultExec: ExecFn = (file, args, options) =>
  execFileAsync(file, args, { ...options, encoding: "utf8" })

const LABEL = "dev.gentic.agent"

// `launchctl print-disabled <domain>` lists every label the domain knows an
// override for. macOS 13+ renders the value as `enabled`/`disabled`; older
// releases print `false`/`true`.
const DISABLED_ENTRY = new RegExp(`"${LABEL.replaceAll(".", "\\.")}"\\s*=>\\s*(\\S+)`)

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

  constructor(private readonly exec: ExecFn = defaultExec) {}

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
      await this.exec("launchctl", ["print", serviceTarget()])
      return true
    } catch {
      return false
    }
  }

  private async isDisabled(): Promise<boolean> {
    try {
      const { stdout } = await this.exec("launchctl", ["print-disabled", domainTarget()])
      const value = DISABLED_ENTRY.exec(stdout)?.[1]
      return value === "true" || value === "disabled"
    } catch {
      return false
    }
  }

  // `stop()` records a persistent disable so the worker stays down across a
  // reboot. That override outlives the plist, so every path that loads the job
  // has to clear it first — `bootstrap` on a disabled label fails outright.
  private async enable(): Promise<void> {
    try {
      await this.exec("launchctl", ["enable", serviceTarget()])
    } catch (error) {
      throw new Error(`launchctl enable failed: ${describe(error)}`)
    }
  }

  async install(opts: ServiceInstallOptions): Promise<void> {
    await mkdir(join(homedir(), "Library", "LaunchAgents"), { recursive: true })
    await mkdir(join(homedir(), "Library", "Logs", "gentic"), { recursive: true })
    await writeFile(plistPath(), this.plistContents(opts.enableOnBoot), "utf8")

    if (await this.isLoaded()) {
      await this.exec("launchctl", ["bootout", serviceTarget()]).catch(() => undefined)
    }

    await this.enable()

    try {
      await this.exec("launchctl", ["bootstrap", domainTarget(), plistPath()])
    } catch (error) {
      throw new Error(`launchctl bootstrap failed: ${describe(error)}`)
    }
  }

  async uninstall(): Promise<void> {
    if (!existsSync(plistPath())) return
    await this.exec("launchctl", ["bootout", serviceTarget()]).catch(() => undefined)
    // Clear the override too, so a later re-install doesn't inherit a disable
    // recorded by a `gentic stop` from before the uninstall.
    await this.exec("launchctl", ["enable", serviceTarget()]).catch(() => undefined)
    await rm(plistPath(), { force: true })
  }

  async start(): Promise<void> {
    if (!existsSync(plistPath())) {
      throw new Error("gentic service is not installed; run `gentic start` to install it")
    }

    await this.enable()

    if (await this.isLoaded()) {
      await this.exec("launchctl", ["kickstart", serviceTarget()]).catch((error) => {
        throw new Error(`launchctl kickstart failed: ${describe(error)}`)
      })
      return
    }

    try {
      await this.exec("launchctl", ["bootstrap", domainTarget(), plistPath()])
    } catch (error) {
      throw new Error(`launchctl bootstrap failed: ${describe(error)}`)
    }
  }

  async stop(): Promise<void> {
    if (!existsSync(plistPath())) return

    // Booting the job out only unloads it for this boot session: launchd
    // re-reads ~/Library/LaunchAgents at the next login and RunAtLoad starts
    // the worker again. The disable override lives in launchd's own database
    // and survives the reboot, so a stopped worker stays stopped until
    // `gentic start` clears it.
    try {
      await this.exec("launchctl", ["disable", serviceTarget()])
    } catch (error) {
      throw new Error(`launchctl disable failed: ${describe(error)}`)
    }

    if (!(await this.isLoaded())) return
    try {
      await this.exec("launchctl", ["bootout", serviceTarget()])
    } catch (error) {
      throw new Error(`launchctl bootout failed: ${describe(error)}`)
    }
  }

  async restart(): Promise<void> {
    if (await this.isLoaded()) {
      try {
        await this.exec("launchctl", ["kickstart", "-k", serviceTarget()])
      } catch (error) {
        throw new Error(`launchctl kickstart failed: ${describe(error)}`)
      }
      return
    }
    await this.start()
  }

  async reload(): Promise<void> {
    if (!(await this.isLoaded())) {
      throw new Error("gentic service is not running")
    }
    try {
      await this.exec("launchctl", ["kill", "SIGHUP", serviceTarget()])
    } catch (error) {
      throw new Error(`launchctl kill failed: ${describe(error)}`)
    }
  }

  async status(): Promise<ServiceStatus> {
    if (!existsSync(plistPath())) return { state: "not-installed" }

    try {
      const { stdout } = await this.exec("launchctl", ["print", serviceTarget()])
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
    // A disable override wins over RunAtLoad: launchd refuses to load the job
    // at login while it is set.
    if (await this.isDisabled()) return false
    const contents = await readFile(plistPath(), "utf8")
    return /<key>RunAtLoad<\/key>\s*<true\/>/.test(contents)
  }

  async logs(opts: ServiceLogsOptions): Promise<void> {
    const log = logPath()
    if (!existsSync(log)) {
      throw new Error(`No log file found at ${log}`)
    }

    const args = opts.follow ? ["-f", log] : ["-n", "200", log]
    await spawnInteractive("tail", args)
  }
}
