const LIMIT_MARKERS = [
  "usage limit",
  "session limit",
  "rate limit",
  "quota",
  "too many requests",
  "429",
]

const RESET_MARKERS = ["reset", "retry", "try again", "available", "until"]

export function getUsageLimitResetAt(
  error: unknown,
  now = new Date(),
  options: { defaultTimeZone?: "local" | "utc" } = {}
): string | null {
  const message = describe(error)
  const lower = message.toLowerCase()
  if (
    !LIMIT_MARKERS.some((marker) => lower.includes(marker)) ||
    !RESET_MARKERS.some((marker) => lower.includes(marker))
  ) {
    return null
  }

  const defaultTimeZone = options.defaultTimeZone ?? "local"
  const resetAt =
    parseRelativeReset(message, now) ??
    parseAbsoluteReset(message, now, defaultTimeZone) ??
    parseTimeOnlyReset(message, now, defaultTimeZone)

  return resetAt && resetAt.getTime() > now.getTime()
    ? resetAt.toISOString()
    : null
}

/**
 * Renders an error for logs/persistence, unwrapping ACP `RequestError`s whose
 * `.message` is a generic JSON-RPC string (e.g. "Internal error") by
 * appending the real text the agent process put in `.data`. Unlike the full
 * `describe()` used for usage-limit marker matching, this omits the stack
 * trace since it's meant to be read directly (log lines, persisted
 * `run_error`).
 */
export function describeAgentError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error)
  }
  return [error.message, ...acpErrorDetails(error)].filter(Boolean).join(": ")
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const parts = [error.message, error.stack, ...acpErrorDetails(error)]
    return parts.filter(Boolean).join("\n")
  }
  return String(error)
}

// ACP errors (e.g. codex-acp) carry the real error text in a JSON-RPC `data`
// payload instead of `.message`, which is often just "Internal error".
function acpErrorDetails(error: Error): string[] {
  const data = (error as { data?: unknown }).data
  if (!data || typeof data !== "object") {
    return []
  }
  const { message, additionalDetails } = data as {
    message?: unknown
    additionalDetails?: unknown
  }
  return [message, additionalDetails].filter(
    (value): value is string => typeof value === "string"
  )
}

function parseRelativeReset(message: string, now: Date): Date | null {
  const match = message.match(
    /\bin\s+(?:(\d+)\s*(?:d|day|days)\b)?\s*(?:(\d+)\s*(?:h|hr|hrs|hour|hours)\b)?\s*(?:(\d+)\s*(?:m|min|mins|minute|minutes)\b)?/i
  )
  if (!match) {
    return null
  }

  const days = Number(match[1] ?? 0)
  const hours = Number(match[2] ?? 0)
  const minutes = Number(match[3] ?? 0)
  const totalMs =
    days * 24 * 60 * 60 * 1000 + hours * 60 * 60 * 1000 + minutes * 60 * 1000

  return totalMs > 0 ? new Date(now.getTime() + totalMs) : null
}

function parseAbsoluteReset(
  message: string,
  now: Date,
  defaultTimeZone: "local" | "utc"
): Date | null {
  const match = message.match(
    /(?:reset(?:s)?|retry|try again|available|until)(?:\s+\w+){0,3}\s+(?:at|on|after|by)?\s*(?:([A-Z][a-z]+ \d{1,2}(?:st|nd|rd|th)?,? \d{4}(?:,)?\s+\d{1,2}:\d{2}(?:\s*[AP]M)?)(?:\s*([A-Z]{2,4}))?|(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?))/i
  )
  if (!match) {
    return null
  }
  const [, human, tz, iso] = match

  if (iso) {
    const parsed = new Date(iso)
    return Number.isNaN(parsed.getTime()) || parsed <= now ? null : parsed
  }

  // Strip ordinal suffixes (e.g. "5th" -> "5") — Codex's usage-limit
  // messages use them, but the Date constructor can't parse them.
  const dateText = human.replace(/(\d)(?:st|nd|rd|th)\b/i, "$1")
  // A bare "Month day, year time" string is parsed in the local timezone of
  // the machine running this, so pin it explicitly using the message's own
  // timezone abbreviation (if any) or the caller's default.
  const dateTextWithZone = tz
    ? `${dateText} ${tz}`
    : defaultTimeZone === "utc"
      ? `${dateText} UTC`
      : dateText
  const parsed = new Date(dateTextWithZone)
  return Number.isNaN(parsed.getTime()) || parsed <= now ? null : parsed
}

function parseTimeOnlyReset(
  message: string,
  now: Date,
  defaultTimeZone: "local" | "utc"
): Date | null {
  const match = message.match(
    /(?:reset(?:s)?|retry|try again|available)(?:\s+\w+){0,3}\s+(?:at|after|by)?\s*(\d{1,2})(?::(\d{2}))?\s*([AP]M)?(?:\s*\((UTC)\))?/i
  )
  if (!match) {
    return null
  }

  let hours = Number(match[1])
  const minutes = Number(match[2] ?? 0)
  const meridiem = match[3]?.toLowerCase()

  if (hours > 23 || minutes > 59) {
    return null
  }
  if (meridiem === "pm" && hours < 12) {
    hours += 12
  } else if (meridiem === "am" && hours === 12) {
    hours = 0
  }

  const useUtc = match[4]?.toLowerCase() === "utc" || defaultTimeZone === "utc"
  const resetAt =
    useUtc
      ? new Date(
          Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate(),
            hours,
            minutes,
            0,
            0
          )
        )
      : new Date(now)

  if (!useUtc) {
    resetAt.setHours(hours, minutes, 0, 0)
  }
  if (resetAt <= now) {
    if (useUtc) {
      resetAt.setUTCDate(resetAt.getUTCDate() + 1)
    } else {
      resetAt.setDate(resetAt.getDate() + 1)
    }
  }

  return resetAt
}
