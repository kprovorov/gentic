import { realpathSync } from "node:fs"
import { basename, delimiter, isAbsolute, join } from "node:path"

export interface GenticExecutable {
  /** Absolute path to the executable running this process. */
  command: string
  /** Arguments needed before the gentic subcommand, e.g. ["dist/cli.js"] for Node. */
  args: string[]
}

interface RuntimeEntry {
  execPath: string
  argv: string[]
  env?: { PATH?: string }
}

/**
 * Package managers install the real binary under a versioned directory
 * (e.g. Homebrew's Cellar/gentic/<version>/libexec/gentic) and expose a
 * stable symlink on PATH (<prefix>/bin/gentic, /usr/bin/gentic). Because
 * `process.execPath` resolves symlinks, baking it into a service unit pins
 * the unit to a single version: the next upgrade deletes that versioned
 * directory and the service fails to launch (systemd status=203/EXEC) until
 * it is reinstalled. Prefer a PATH entry that resolves to the same file — the
 * package manager keeps that symlink pointing at the current version.
 */
export function stableExecutablePath(execPath: string, envPath?: string): string {
  let realExec: string
  try {
    realExec = realpathSync(execPath)
  } catch {
    return execPath
  }

  const name = basename(realExec)
  for (const dir of (envPath ?? "").split(delimiter)) {
    // Service units need absolute commands; skip relative PATH entries.
    if (!isAbsolute(dir)) continue
    const candidate = join(dir, name)
    try {
      if (realpathSync(candidate) === realExec) return candidate
    } catch {
      // No such file in this PATH entry — keep looking.
    }
  }
  return execPath
}

/**
 * Resolves the executable that services should launch to invoke `gentic run`.
 * For Node, `process.execPath` is the Node binary and `process.argv[1]` is the
 * script path. For Bun-compiled executables, `process.execPath` is already the
 * gentic binary and `process.argv[1]` can be a virtual `/$bunfs/...` path; that
 * virtual path must not be passed back to the CLI because Commander treats it
 * as an unknown command.
 */
export function resolveGenticExecutable(runtime: RuntimeEntry = process): GenticExecutable {
  const entry = runtime.argv[1]
  if (entry?.startsWith("/$bunfs/")) {
    return { command: stableExecutablePath(runtime.execPath, runtime.env?.PATH), args: [] }
  }
  if (!entry) {
    throw new Error("Unable to resolve the running gentic entry point")
  }
  return { command: runtime.execPath, args: [entry] }
}
