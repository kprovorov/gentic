export type WorkerVersionHealth =
  | "current"
  | "update-available"
  | "unsupported"

export interface WorkerCompatibilityPolicy {
  minimumSupportedVersion: string
  currentVersion: string
}

export const defaultWorkerCompatibilityPolicy = {
  minimumSupportedVersion: "0.14.0",
  currentVersion: "0.14.0",
} as const satisfies WorkerCompatibilityPolicy

export function classifyWorkerVersion(
  version: string | null,
  policy: WorkerCompatibilityPolicy = defaultWorkerCompatibilityPolicy
): WorkerVersionHealth {
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
