export interface GenticExecutable {
  /** Absolute path to the executable running this process. */
  command: string
  /** Arguments needed before the gentic subcommand, e.g. ["dist/cli.js"] for Node. */
  args: string[]
}

interface RuntimeEntry {
  execPath: string
  argv: string[]
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
    return { command: runtime.execPath, args: [] }
  }
  if (!entry) {
    throw new Error("Unable to resolve the running gentic entry point")
  }
  return { command: runtime.execPath, args: [entry] }
}
