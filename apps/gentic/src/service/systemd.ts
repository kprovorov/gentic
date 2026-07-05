import { execFile as execFileCb, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { homedir, userInfo } from "node:os"
import { dirname, join } from "node:path"
import { promisify } from "node:util"

import { resolveGenticExecutable } from "./entry.js"
import type { ServiceBackend, ServiceInstallOptions, ServiceLogsOptions, ServiceScope, ServiceStatus } from "./types.js"

const execFile = promisify(execFileCb)

const SERVICE_NAME = "gentic.service"
const SYSTEM_UNIT_PATH = "/etc/systemd/system/gentic.service"

function describe(error: unknown): string {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = (error as { stderr?: string }).stderr
    if (stderr && stderr.trim().length > 0) return stderr.trim()
  }
  return error instanceof Error ? error.message : String(error)
}

export class SystemdBackend implements ServiceBackend {
  readonly name = "systemd"

  constructor(private readonly scope: ServiceScope = "user") {}

  private unitPath(): string {
    return this.scope === "system"
      ? SYSTEM_UNIT_PATH
      : join(homedir(), ".config", "systemd", "user", SERVICE_NAME)
  }

  private scopeArgs(): string[] {
    return this.scope === "system" ? [] : ["--user"]
  }

  private async systemctl(...args: string[]): Promise<{ stdout: string; stderr: string }> {
    try {
      return await execFile("systemctl", [...this.scopeArgs(), ...args])
    } catch (error) {
      throw new Error(`systemctl ${args.join(" ")} failed: ${describe(error)}`)
    }
  }

  isAvailable(): boolean {
    return existsSync("/run/systemd/system")
  }

  private unitFileContents(): string {
    const { command, entry } = resolveGenticExecutable()
    return `[Unit]
Description=Gentic agent worker
After=network-online.target

[Service]
ExecStart="${command}" "${entry}" run
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`
  }

  async install(opts: ServiceInstallOptions): Promise<void> {
    const unitPath = this.unitPath()
    await mkdir(dirname(unitPath), { recursive: true })
    await writeFile(unitPath, this.unitFileContents(), "utf8")
    await this.systemctl("daemon-reload")

    if (opts.enableOnBoot) {
      await this.systemctl("enable", SERVICE_NAME)

      if (this.scope === "user") {
        const user = userInfo().username
        try {
          await execFile("loginctl", ["enable-linger", user])
        } catch (error) {
          throw new Error(
            `Enabled gentic.service but failed to enable lingering for user "${user}" ` +
              `(${describe(error)}). Without lingering, the user service will not start ` +
              "until you log in again after a reboot. Run `loginctl enable-linger " +
              `${user}\` manually with sufficient privileges, or use \`gentic start --system\` ` +
              "to install a system-level unit instead.",
          )
        }
      }
    }
  }

  async uninstall(): Promise<void> {
    const unitPath = this.unitPath()
    if (!existsSync(unitPath)) return

    await this.systemctl("stop", SERVICE_NAME).catch(() => undefined)
    await this.systemctl("disable", SERVICE_NAME).catch(() => undefined)
    await rm(unitPath, { force: true })
    await this.systemctl("daemon-reload")
  }

  async start(): Promise<void> {
    await this.systemctl("start", SERVICE_NAME)
  }

  async stop(): Promise<void> {
    await this.systemctl("stop", SERVICE_NAME)
  }

  async restart(): Promise<void> {
    await this.systemctl("restart", SERVICE_NAME)
  }

  async status(): Promise<ServiceStatus> {
    if (!existsSync(this.unitPath())) {
      return { state: "not-installed" }
    }

    const { stdout } = await this.systemctl(
      "show",
      SERVICE_NAME,
      "--property=ActiveState",
      "--property=MainPID",
      "--property=ActiveEnterTimestamp",
    )

    const props = Object.fromEntries(
      stdout
        .split("\n")
        .filter((line) => line.includes("="))
        .map((line) => {
          const index = line.indexOf("=")
          return [line.slice(0, index), line.slice(index + 1)]
        }),
    )

    const running = props.ActiveState === "active"
    const pid = Number(props.MainPID)
    const since = props.ActiveEnterTimestamp ? new Date(props.ActiveEnterTimestamp) : undefined

    return {
      state: running ? "running" : "stopped",
      pid: running && pid > 0 ? pid : undefined,
      since: running && since && !Number.isNaN(since.getTime()) ? since : undefined,
    }
  }

  async isEnabledOnBoot(): Promise<boolean> {
    if (!existsSync(this.unitPath())) return false

    const enabled = await this.systemctl("is-enabled", SERVICE_NAME)
      .then(({ stdout }) => stdout.trim() === "enabled")
      .catch(() => false)
    if (!enabled) return false
    if (this.scope === "system") return true

    const user = userInfo().username
    try {
      const { stdout } = await execFile("loginctl", ["show-user", user, "--property=Linger"])
      return stdout.trim() === "Linger=yes"
    } catch {
      return false
    }
  }

  async logs(opts: ServiceLogsOptions): Promise<void> {
    const args = [...this.scopeArgs(), "-u", SERVICE_NAME]
    args.push(opts.follow ? "-f" : "--no-pager")

    await new Promise<void>((resolve, reject) => {
      const child = spawn("journalctl", args, { stdio: "inherit" })
      child.on("error", reject)
      child.on("exit", (code) => {
        if (code === 0 || code === null) resolve()
        else reject(new Error(`journalctl exited with code ${code}`))
      })
    })
  }
}
