#!/bin/bash
set -e

pnpm install

# Copy per-app env files from the root checkout so each workspace points at
# the same local Supabase/Clerk config without re-entering secrets. Supabase
# itself is a shared, long-running instance keyed by project_id in
# supabase/config.toml (started once via `supabase start`), not something a
# workspace should start or stop on its own.
for app in web gentic; do
  src="$SUPERSET_ROOT_PATH/apps/$app/.env"
  dest="apps/$app/.env"
  if [ -f "$src" ]; then
    cp "$src" "$dest"
  fi
done
