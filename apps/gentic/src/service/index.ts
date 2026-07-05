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

  const launchd = new LaunchdBackend()
  if (launchd.isAvailable()) return launchd

  return new FallbackBackend()
}
