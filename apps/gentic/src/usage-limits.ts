const LIMIT_MARKERS = [
  "usage limit",
  "rate limit",
  "quota",
  "too many requests",
  "429",
]

const RESET_MARKERS = ["reset", "retry", "try again", "available", "until"]

export function getUsageLimitResetAt(
  error: unknown,
  now = new Date()
): string | null {
  const message = describe(error)
  const lower = message.toLowerCase()
  if (
    !LIMIT_MARKERS.some((marker) => lower.includes(marker)) ||
    !RESET_MARKERS.some((marker) => lower.includes(marker))
  ) {
    return null
  }

  const resetAt =
    parseRelativeReset(message, now) ??
    parseAbsoluteReset(message, now) ??
    parseTimeOnlyReset(message, now)

  return resetAt && resetAt.getTime() > now.getTime()
    ? resetAt.toISOString()
    : null
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return [error.message, error.stack].filter(Boolean).join("\n")
  }
  return String(error)
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

function parseAbsoluteReset(message: string, now: Date): Date | null {
  const match = message.match(
    /(?:reset(?:s)?|retry|try again|available|until)(?:\s+\w+){0,3}\s+(?:at|on|after|by)?\s*([A-Z][a-z]+ \d{1,2},? \d{4}(?:,)?\s+\d{1,2}:\d{2}(?:\s*[AP]M)?(?:\s*[A-Z]{2,4})?|\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/i
  )
  if (!match) {
    return null
  }

  const parsed = new Date(match[1])
  return Number.isNaN(parsed.getTime()) || parsed <= now ? null : parsed
}

function parseTimeOnlyReset(message: string, now: Date): Date | null {
  const match = message.match(
    /(?:reset(?:s)?|retry|try again|available)(?:\s+\w+){0,3}\s+(?:at|after|by)?\s*(\d{1,2})(?::(\d{2}))?\s*([AP]M)?/i
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

  const resetAt = new Date(now)
  resetAt.setHours(hours, minutes, 0, 0)
  if (resetAt <= now) {
    resetAt.setDate(resetAt.getDate() + 1)
  }

  return resetAt
}
