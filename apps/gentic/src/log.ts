/**
 * Console logging for the worker. Each line is prefixed with an ISO timestamp
 * and `[gentic]` so output stays legible when tailed or shipped to a log
 * aggregator.
 */
function prefix(): string {
  return `${new Date().toISOString()} [gentic]`
}

export function logInfo(...args: unknown[]): void {
  console.log(prefix(), ...args)
}

export function logError(...args: unknown[]): void {
  console.error(prefix(), ...args)
}
