#!/usr/bin/env bash
# Compiles gentic into a single-file, dependency-free executable for one
# platform using `bun build --compile`, plus standalone sidecar binaries for
# the ACP agents it spawns as child processes (see src/session.ts).
#
# Requires Bun (build-time only — the output binaries do not need Bun, Node,
# or node_modules on the machine they run on) and a completed `pnpm install`
# at the repo root so apps/gentic/node_modules is populated.
set -euo pipefail

TARGET="${1:?usage: build-binary.sh <bun-target> <output-dir>}"
OUT_ARG="${2:?usage: build-binary.sh <bun-target> <output-dir>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

case "$OUT_ARG" in
  /*) OUT="$OUT_ARG" ;;
  *) OUT="$(pwd)/$OUT_ARG" ;;
esac

cd "$APP_DIR"

if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun is required to build gentic (install: https://bun.sh)" >&2
  exit 1
fi

mkdir -p "$OUT/vendor/claude-agent-acp" "$OUT/vendor/codex-acp"

echo "==> Compiling claude-agent-acp sidecar ($TARGET)"
bun build node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js \
  --compile --target="$TARGET" \
  --outfile "$OUT/vendor/claude-agent-acp/claude-agent-acp"

# claude-agent-acp shells out to a native `claude` CLI binary that
# @anthropic-ai/claude-agent-sdk ships as a per-platform optionalDependency.
# It locates that binary via import.meta.resolve at runtime, which doesn't
# work inside the compiled sidecar (no node_modules on the target machine),
# so vendor it here and point CLAUDE_CODE_EXECUTABLE at it (src/session.ts).
case "$TARGET" in
  bun-linux-x64-musl) NATIVE_OS=linux; NATIVE_ARCH=x64; NATIVE_LIBC=musl ;;
  bun-linux-arm64-musl) NATIVE_OS=linux; NATIVE_ARCH=arm64; NATIVE_LIBC=musl ;;
  bun-linux-x64*) NATIVE_OS=linux; NATIVE_ARCH=x64; NATIVE_LIBC= ;;
  bun-linux-arm64*) NATIVE_OS=linux; NATIVE_ARCH=arm64; NATIVE_LIBC= ;;
  bun-darwin-x64*) NATIVE_OS=darwin; NATIVE_ARCH=x64; NATIVE_LIBC= ;;
  bun-darwin-arm64*) NATIVE_OS=darwin; NATIVE_ARCH=arm64; NATIVE_LIBC= ;;
  *)
    echo "error: don't know how to map target '$TARGET' to a native claude binary" >&2
    exit 1
    ;;
esac

echo "==> Vendoring native claude CLI ($NATIVE_OS/$NATIVE_ARCH${NATIVE_LIBC:+/$NATIVE_LIBC})"
NATIVE_CLAUDE_PATH="$(node scripts/resolve-native-claude.mjs "$NATIVE_OS" "$NATIVE_ARCH" "$NATIVE_LIBC")"
cp "$NATIVE_CLAUDE_PATH" "$OUT/vendor/claude-agent-acp/claude"
chmod +x "$OUT/vendor/claude-agent-acp/claude"

echo "==> Compiling codex-acp sidecar ($TARGET)"
bun build node_modules/@agentclientprotocol/codex-acp/dist/index.js \
  --compile --target="$TARGET" \
  --outfile "$OUT/vendor/codex-acp/codex-acp"

echo "==> Compiling gentic CLI ($TARGET)"
bun build src/cli.ts --compile --target="$TARGET" --outfile "$OUT/gentic"

echo "==> Done: $OUT"
