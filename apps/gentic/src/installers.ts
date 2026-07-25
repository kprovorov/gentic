import { spawn } from "node:child_process"
import { accessSync, constants } from "node:fs"
import { delimiter, join } from "node:path"

export type SupportedPlatform = "darwin" | "linux"
export type LinuxPackageManager = "apt-get" | "dnf" | "pacman"

export interface SpawnInteractiveOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
}

const LINUX_PACKAGE_MANAGERS: LinuxPackageManager[] = [
  "apt-get",
  "dnf",
  "pacman",
]

export function detectPlatform(
  platform: NodeJS.Platform = process.platform
): SupportedPlatform {
  if (platform === "darwin" || platform === "linux") return platform
  throw new Error(`Unsupported platform: ${platform}`)
}

export function detectLinuxPackageManager(
  pathValue: string | undefined = process.env.PATH
): LinuxPackageManager | null {
  for (const manager of LINUX_PACKAGE_MANAGERS) {
    if (isCommandOnPath(manager, pathValue)) return manager
  }
  return null
}

export function spawnInteractive(
  command: string,
  args: string[],
  options: SpawnInteractiveOptions = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      cwd: options.cwd,
      env: options.env,
    })

    child.on("error", reject)
    child.on("exit", (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`))
      }
    })
  })
}

function isCommandOnPath(
  command: string,
  pathValue: string | undefined
): boolean {
  if (!pathValue) return false

  return pathValue.split(delimiter).some((entry) => {
    if (!entry) return false
    try {
      accessSync(join(entry, command), constants.X_OK)
      return true
    } catch {
      return false
    }
  })
}
