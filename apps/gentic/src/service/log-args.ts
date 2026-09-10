import type { ServiceLogsOptions } from "./types.js"

/**
 * Both log readers default to a window that surprises people: `journalctl`
 * prints the whole journal for the unit, and `tail -f` starts from only the
 * last 10 lines. Always pass an explicit `-n` so `gentic logs` shows the same
 * amount of history whether or not it goes on to follow.
 */
export function journalctlArgs(
  scopeArgs: string[],
  unit: string,
  opts: ServiceLogsOptions,
): string[] {
  const args = [...scopeArgs, "-u", unit, "-n", String(opts.lines)]
  // `-f` implies no pager, so the two flags are mutually exclusive here.
  args.push(opts.follow ? "-f" : "--no-pager")
  return args
}

export function tailArgs(file: string, opts: ServiceLogsOptions): string[] {
  const args = ["-n", String(opts.lines)]
  if (opts.follow) args.push("-f")
  args.push(file)
  return args
}
