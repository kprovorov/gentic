import { existsSync } from "node:fs"
import { userInfo } from "node:os"

import { FallbackBackend } from "./fallback.js"
import { LaunchdBackend } from "./launchd.js"
import { SystemdBackend } from "./systemd.js"
import type { ServiceBackend, ServiceScope } from "./types.js"

export type { ServiceBackend, ServiceInstallOptions, ServiceLogsOptions, ServiceScope, ServiceStatus } from "./types.js"

export function getServiceBackend(opts: { scope?: ServiceScope } = {}): ServiceBackend {
  const scope = opts.scope ?? "user"

  if (scope === "system") {
    const systemd = new SystemdBackend("system")
    if (!systemd.isAvailable()) {
      throw new Error("`--system` is only supported with systemd; no systemd installation was found")
    }
    return systemd
  }

  const systemd = new SystemdBackend("user")
  if (systemd.isAvailable()) return systemd

  // A systemd host whose per-user bus isn't reachable (common over SSH without
  // lingering, or inside a container with no /run/user/<uid>). Don't silently
  // degrade to the non-durable nohup fallback — point at a durable option.
  if (existsSync("/run/systemd/system")) {
    const user = userInfo().username
    throw new Error(
      "systemd is installed but your per-user service bus isn't reachable — usually " +
        "because there's no active login session for this user (common over SSH without " +
        "lingering, or inside a container). Fix it one of these ways:\n" +
        `  • enable lingering, then start a fresh session: \`loginctl enable-linger ${user}\`\n` +
        "  • install a system-level unit (needs privileges): `gentic start --system`",
    )
  }

  const launchd = new LaunchdBackend()
  if (launchd.isAvailable()) return launchd

  return new FallbackBackend()
}
