export type HostVersionHealth =
  | "current"
  | "update-available"
  | "unsupported"

export interface HostCompatibilityPolicy {
  minimumSupportedVersion: string
  currentVersion: string
}

/**
 * 0.26.0 is the release that renamed workers to hosts (GEN-435). It moved the
 * agent API off `/api/v1/agent/worker/*` and `/api/v1/workers/exchange` and
 * renamed fields inside the request and response bodies, and the CLI parses
 * those bodies with `.strict()` schemas — so a 0.25.x or older CLI cannot be
 * kept working by serving both spellings. Raising the floor to 0.26.0 makes the
 * claim endpoints answer such a CLI with the existing "unsupported version"
 * rejection, which the operator can act on, instead of letting it spin on 404s
 * from endpoints that no longer exist.
 */
export const defaultHostCompatibilityPolicy = {
  minimumSupportedVersion: "0.26.0",
  currentVersion: "0.26.0",
} as const satisfies HostCompatibilityPolicy

export function classifyHostVersion(
  version: string | null,
  policy: HostCompatibilityPolicy = defaultHostCompatibilityPolicy
): HostVersionHealth {
  const parsedVersion = parseSemver(version)
  const minimumSupported = parseSemver(policy.minimumSupportedVersion)
  const current = parseSemver(policy.currentVersion)

  if (!parsedVersion || !minimumSupported || !current) {
    return "unsupported"
  }
  if (compareSemver(parsedVersion, minimumSupported) < 0) {
    return "unsupported"
  }
  if (compareSemver(parsedVersion, current) < 0) {
    return "update-available"
  }
  return "current"
}

type ParsedSemver = readonly [number, number, number]

function parseSemver(version: string | null): ParsedSemver | null {
  const match = version
    ?.trim()
    .match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)

  if (!match) {
    return null
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compareSemver(left: ParsedSemver, right: ParsedSemver): number {
  for (let index = 0; index < left.length; index++) {
    const diff = left[index] - right[index]
    if (diff !== 0) {
      return diff
    }
  }
  return 0
}
