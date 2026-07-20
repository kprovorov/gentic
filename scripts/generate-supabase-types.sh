#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_FILE="$ROOT_DIR/packages/supabase/src/database.types.ts"

cd "$ROOT_DIR"

TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT

if ! {
  echo "// Generated from Supabase migrations. Refresh with \`pnpm db:types\`."
  pnpm dlx supabase@2.109.1 gen types --lang=typescript --local --schema public
} > "$TMP_FILE"; then
  cat "$TMP_FILE" >&2
  exit 1
fi

mv "$TMP_FILE" "$OUT_FILE"
trap - EXIT
