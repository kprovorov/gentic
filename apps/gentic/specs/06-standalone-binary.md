# 06 — Standalone binary compilation

## Context

Depends on spec 01 only (needs `src/cli.ts` as the single entrypoint).
Can be developed in parallel with specs 02-05, but the final artifact is
most useful once those have landed too (a compiled binary missing `auth`/
`start`/`status` isn't very useful) — sequence your own testing
accordingly, but the build mechanism itself doesn't need them.

Read `src/session.ts` closely before starting — it contains the one thing
in this codebase that makes naive bundling break silently (see below).

## Goal

Produce a single-file, dependency-free executable per platform
(`linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64` at minimum) that
runs `gentic` without a Node install, an `npm install`, or the monorepo's
`node_modules` present on the target machine.

## Why Bun compile, not Node SEA

Node's Single Executable Application feature (`node --experimental-sea-config`
+ `postject`) requires a CommonJS-compatible entry and has known rough
edges with ESM and `import.meta.url`-based resolution (`createRequire`,
`require.resolve` against `import.meta.url`, both used in
`src/session.ts`). `bun build --compile` bundles ESM correctly, is a single
command, and produces a working executable with much less ceremony. The
tradeoff: Bun becomes a **build-time** dependency (not a runtime one — the
output binary doesn't need Bun installed on the target machine). Confirm
Bun is available in CI before wiring the release workflow (spec 07) —
don't assume it's preinstalled everywhere.

## The one hard problem: the ACP agent child process

`src/session.ts` does this:

```ts
const require = createRequire(import.meta.url)
const AGENT_ENTRY = require.resolve(
  "@agentclientprotocol/claude-agent-acp/dist/index.js"
)
// ...
const child = spawn(process.execPath, [AGENT_ENTRY], { ... })
```

This spawns a **separate Node process** running the ACP agent
(`claude-agent-acp`) and talks to it over stdio, per the Agent Client
Protocol's design (agent and client are meant to be separate processes).
Bun's bundler only inlines things that are `import`ed, not things resolved
via `require.resolve` and handed to `spawn` as a file path — so a naive
`bun build --compile` produces a binary that crashes at runtime the first
time it tries to start a session, because `AGENT_ENTRY` points at a path
inside `node_modules` that no longer exists on the target machine.

**Do not** try to eliminate the separate process and inline the ACP agent
in-process — that would change the isolation model ACP is designed around
(the agent and client are supposed to be able to crash independently) and
is out of scope here.

**Do** ship the ACP agent's `dist/` directory as a sidecar next to the
compiled binary, and change the resolution logic to look there first:

1. At build time, copy `node_modules/@agentclientprotocol/claude-agent-acp/dist`
   (and its own `node_modules` if it has runtime deps that aren't bundled —
   check its `package.json`) into a `vendor/claude-agent-acp/` directory
   next to each compiled binary in the release artifact.
2. At runtime, change `session.ts`'s resolution to prefer a path relative
   to the running executable when one exists:

   ```ts
   import { existsSync } from "node:fs"
   import { dirname, join } from "node:path"

   function resolveAgentEntry(): string {
     const sidecar = join(
       dirname(process.execPath),
       "vendor/claude-agent-acp/index.js"
     )
     if (existsSync(sidecar)) return sidecar
     const require = createRequire(import.meta.url)
     return require.resolve("@agentclientprotocol/claude-agent-acp/dist/index.js")
   }
   ```

   (Adjust the sidecar's exact relative path to whatever the build step
   actually produces — the point is: compiled-binary mode checks a
   location next to the executable first, dev/pnpm mode falls back to
   today's `require.resolve` unchanged.)

   Note: when compiled with `bun build --compile`, `process.execPath` is
   the compiled binary's own path (not a `bun` or `node` install) — verify
   this assumption holds for your Bun version before relying on it; if it
   doesn't, use `process.argv[0]` or Bun's own equivalent and document
   which you used.

## Build script

Add `apps/gentic/scripts/build-binary.sh` (or a `package.json` script,
whichever fits the repo's existing conventions — check if other apps in
this monorepo have a build script pattern worth matching):

```bash
#!/usr/bin/env bash
set -euo pipefail
TARGET="${1:?usage: build-binary.sh <bun-target> <output-dir>}"
OUT="${2:?usage: build-binary.sh <bun-target> <output-dir>}"

mkdir -p "$OUT/vendor/claude-agent-acp"
cp -r node_modules/@agentclientprotocol/claude-agent-acp/dist/. \
  "$OUT/vendor/claude-agent-acp/"

bun build src/cli.ts --compile --target="$TARGET" --outfile "$OUT/gentic"
```

Valid `--target` values as of writing: `bun-linux-x64`, `bun-linux-arm64`,
`bun-darwin-x64`, `bun-darwin-arm64` (check Bun's current docs for the
authoritative list/naming — it has changed between versions).

## Acceptance criteria

- Running `./build-binary.sh bun-linux-x64 dist/linux-x64` on a machine
  with `pnpm install` already done produces `dist/linux-x64/gentic` and
  `dist/linux-x64/vendor/claude-agent-acp/`.
- Copy just that output directory to a clean machine/container with no
  Node, no Bun, no `node_modules` — `./gentic run` (with a valid
  `GENTIC_API_KEY`/`GENTIC_API_URL` in env) starts the poll loop and, when
  an issue is claimed, successfully spawns the ACP agent from the sidecar
  path and completes a session. This is the actual test that matters —
  typecheck passing is not sufficient evidence this works, because the
  failure mode is a runtime `spawn`/`resolve` error, not a type error.
- `gentic --help` and `gentic --version` work from the compiled binary.
- Binary size and build time are noted in the PR description (sets a
  baseline for spec 07's release workflow timeout budgeting).

## Explicitly out of scope

- Code signing / notarization for macOS binaries (Gatekeeper will warn on
  first run) — flag as a follow-up for spec 07 if distribution friction
  turns out to matter.
- Windows target — not requested; skip unless asked.
