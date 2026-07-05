export interface GenticExecutable {
  /** Absolute path to the node binary running this process. */
  command: string
  /** Absolute path to the currently running gentic entry point (e.g. dist/cli.js). */
  entry: string
}

/**
 * Resolves the executable that services should launch to invoke `gentic run`.
 * Uses `process.argv[1]` (the script path Node was invoked with) rather than
 * `which gentic` so installed services keep pointing at the exact entry point
 * that installed them, the same way session.ts re-spawns agent entries.
 */
export function resolveGenticExecutable(): GenticExecutable {
  const entry = process.argv[1]
  if (!entry) {
    throw new Error("Unable to resolve the running gentic entry point")
  }
  return { command: process.execPath, entry }
}
