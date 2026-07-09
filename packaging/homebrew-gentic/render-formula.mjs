#!/usr/bin/env node
// Renders the Homebrew formula for the gentic worker from the template next to
// this script, filling in the release version and the per-target sha256s parsed
// out of the release's checksums.txt. The rendered file is published to the tap
// repo (kprovorov/homebrew-tap) by the `homebrew` job in .github/workflows/
// release.yml. See ./README.md for the full pipeline.
//
// Usage:
//   node render-formula.mjs --version <x.y.z> --checksums <path/to/checksums.txt>
//
// Writes the rendered formula to stdout. Exits non-zero (without emitting a
// partial formula) if any target's checksum is missing or a placeholder is left
// unresolved — we never want to publish a formula with a stale or bogus sha256.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i]?.replace(/^--/, ""), process.argv[i + 1])
}

const version = args.get("version")
const checksumsPath = args.get("checksums")
if (!version || !checksumsPath) {
  console.error(
    "usage: render-formula.mjs --version <x.y.z> --checksums <path>"
  )
  process.exit(1)
}

// asset os-arch slug -> template placeholder suffix.
const targets = {
  "darwin-arm64": "DARWIN_ARM64",
  "darwin-x64": "DARWIN_X64",
  "linux-arm64": "LINUX_ARM64",
  "linux-x64": "LINUX_X64",
}

// checksums.txt tarball lines look like:
//   "<sha256>  gentic-<version>-<os-arch>.tar.gz"
// (the file also carries .deb/.rpm/.apk lines, which this regex skips).
const versionPattern = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const tarballRe = new RegExp(
  `^([0-9a-f]{64})\\s+gentic-${versionPattern}-(\\S+?)\\.tar\\.gz\\s*$`
)
const shas = {}
for (const line of readFileSync(checksumsPath, "utf8").split("\n")) {
  const match = line.match(tarballRe)
  if (match) shas[match[2]] = match[1]
}

const here = dirname(fileURLToPath(import.meta.url))
let formula = readFileSync(join(here, "gentic.rb.tmpl"), "utf8")
formula = formula.replaceAll("__VERSION__", version)

for (const [target, key] of Object.entries(targets)) {
  const sha = shas[target]
  if (!sha) {
    console.error(
      `error: no checksum for gentic-${version}-${target}.tar.gz in ${checksumsPath}`
    )
    process.exit(1)
  }
  formula = formula.replaceAll(`__SHA_${key}__`, sha)
}

const leftover = formula.match(/__[A-Z0-9_]+__/)
if (leftover) {
  console.error(`error: unresolved placeholder ${leftover[0]} in formula`)
  process.exit(1)
}

process.stdout.write(formula)
