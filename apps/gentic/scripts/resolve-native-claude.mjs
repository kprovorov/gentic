#!/usr/bin/env node
// Resolves the absolute path to the native `claude` CLI binary that
// @anthropic-ai/claude-agent-sdk ships as a per-platform optionalDependency,
// for a given (target-os, target-arch) pair. Prints the path on success.
//
// Mirrors the two-hop resolution @agentclientprotocol/claude-agent-acp
// performs at runtime (see its dist/acp-agent.js, claudeCliPath()): pnpm's
// strict node_modules isolation means the platform package is only
// resolvable as a dependency of @anthropic-ai/claude-agent-sdk, which is
// itself only resolvable as a dependency of claude-agent-acp — so we walk
// the same chain via createRequire rather than trying to reach the platform
// package directly from apps/gentic's own node_modules view.
//
// Called from build-binary.sh at build time, once per target, to vendor the
// binary next to the compiled sidecar. It cannot find a platform package
// that pnpm didn't install (pnpm only installs the optionalDependency
// matching the *current host's* os/arch/libc) — cross-compiling for a
// platform other than the build host requires that platform's package to
// be present in node_modules first (e.g. via pnpm's supportedArchitectures
// config), or running this build on/for a matching host.

import { createRequire } from "node:module"

const [, , targetOs, targetArch, libc] = process.argv

if (!targetOs || !targetArch) {
  console.error(
    "usage: resolve-native-claude.mjs <linux|darwin> <x64|arm64> [musl]"
  )
  process.exit(1)
}

const packageName = libc
  ? `@anthropic-ai/claude-agent-sdk-${targetOs}-${targetArch}-${libc}`
  : `@anthropic-ai/claude-agent-sdk-${targetOs}-${targetArch}`

try {
  const appRequire = createRequire(import.meta.url)
  const claudeAgentAcpEntry = appRequire.resolve(
    "@agentclientprotocol/claude-agent-acp/dist/index.js"
  )
  const acpRequire = createRequire(claudeAgentAcpEntry)
  const sdkEntry = acpRequire.resolve("@anthropic-ai/claude-agent-sdk")
  const sdkRequire = createRequire(sdkEntry)
  const claudeBinary = sdkRequire.resolve(`${packageName}/claude`)
  process.stdout.write(claudeBinary)
} catch (error) {
  console.error(
    `error: could not resolve ${packageName}/claude — is it installed for this host? ` +
      `pnpm only installs the optionalDependency matching the machine running ` +
      `'pnpm install'. To vendor a native claude binary for a different target, ` +
      `install this package's optional dependency for that platform first ` +
      `(pnpm config: supportedArchitectures), or run this build on/for a host ` +
      `matching ${targetOs}/${targetArch}${libc ? `/${libc}` : ""}.\n` +
      String(error instanceof Error ? error.message : error)
  )
  process.exit(1)
}
