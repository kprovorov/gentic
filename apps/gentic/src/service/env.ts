import { homedir } from "node:os"
import { join } from "node:path"

const DEFAULT_PATHS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
]

/**
 * launchd and systemd services do not inherit the user's interactive shell
 * PATH. Keep the install-time PATH, then add common package-manager locations
 * so project setup scripts can find tools such as pnpm, npm, gh, codex, etc.
 */
export function buildServicePath(envPath = process.env.PATH, home = homedir()): string {
  const paths = [
    ...(envPath ?? "").split(":"),
    join(home, ".local", "share", "pnpm"),
    join(home, ".local", "bin"),
    join(home, "Library", "pnpm"),
    ...DEFAULT_PATHS,
  ]

  return Array.from(new Set(paths.filter(Boolean))).join(":")
}
