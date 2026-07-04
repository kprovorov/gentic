# Persisted config store

## Context

Today, `apps/gentic/src/config.ts` reads everything from `process.env`
(populated via `.env` + `dotenv/config`), validated by a `zod` schema:
`GENTIC_API_KEY`, `GENTIC_API_URL`, `GIT_REMOTE_BASE`, `WORKDIR`,
`POLL_INTERVAL_MS`. That's fine for a dev checkout but not for an installed
CLI — there's no `.env` file to hand-edit once `gentic` is a Homebrew/apt
package, and a future login command needs somewhere durable to write the
API key to.

### Prerequisite: CLI command scaffolding

This task assumes `apps/gentic` already has a `commander`-based CLI entry
(`src/cli.ts`) with a command-registration pattern like:

```ts
// src/commands/<name>.ts
export function register<Name>Command(program: Command): void { ... }
```

...and a `run` command (`src/commands/run.ts`) wrapping the worker loop. If
none of that exists yet in the repo, this task doesn't strictly need it —
it mostly adds a new, independent module (`config-store.ts`) and edits
`config.ts` — but check `src/cli.ts` / `src/commands/` first so you're not
duplicating a routing convention that's already there.

## Goal

Add a persisted, per-user config file that a future login command writes
to and that `loadConfig()` reads from, with environment variables still
taking precedence for power users / CI / the existing dev workflow.

## Design

### Location

Add a new dependency: `env-paths` (small, zero-dependency, handles
XDG-on-Linux / `Application Support` on macOS / `%APPDATA%` on Windows
correctly — don't hand-roll this).

```ts
import envPaths from "env-paths"
const paths = envPaths("gentic", { suffix: "" })
// paths.config -> e.g. ~/.config/gentic (Linux), ~/Library/Preferences/gentic (macOS)
```

Config file: `<paths.config>/config.json`.

### File format

Flat JSON object mirroring the env var names so the merge logic is trivial:

```json
{
  "GENTIC_API_KEY": "...",
  "GENTIC_API_URL": "https://gentic.chat/api/v1",
  "GIT_REMOTE_BASE": "git@github.com:",
  "WORKDIR": "/home/user/.local/share/gentic/workspaces",
  "POLL_INTERVAL_MS": 3000
}
```

Write it with mode `0o600` (contains a secret). Create the parent directory
recursively if missing (`fs.mkdir(dir, { recursive: true })`).

### New module: `src/config-store.ts`

Export:

```ts
export interface ConfigFile {
  GENTIC_API_KEY?: string
  GENTIC_API_URL?: string
  GIT_REMOTE_BASE?: string
  WORKDIR?: string
  POLL_INTERVAL_MS?: number
}

export function configFilePath(): string
export function readConfigFile(): ConfigFile // returns {} if file doesn't exist
export function writeConfigFile(patch: Partial<ConfigFile>): void // shallow-merges with existing file and writes atomically (write to temp file + rename)
export function clearConfigFile(): void // intended for use by a future logout command
```

Use atomic writes (write to `config.json.tmp` in the same directory, then
`fs.renameSync`) so a crash mid-write can't corrupt the file.

This module is meant to be a stable, reusable dependency for any future
command that needs to read or write persisted settings (a login command,
a logout command, a status command) — keep its exports narrow and
well-typed so those can build on it without touching this file again.

### `config.ts` changes

Change `loadConfig()` to merge three layers, highest precedence first:

1. `process.env` (only the keys actually present in `process.env` — don't
   let zod defaults from an empty env object override the file).
2. `readConfigFile()`.
3. The existing zod schema's own `.default(...)` values for
   `GIT_REMOTE_BASE`, `WORKDIR`, `POLL_INTERVAL_MS`.

Concretely: build a plain object by merging `{ ...configFile,
...pickPresentEnvKeys(process.env) }`, then `zod.parse` it, same as today
just with a richer input object instead of raw `process.env`. Keep
`loadConfig(): Config`'s signature and the exported `Config` type
unchanged so nothing that already calls `loadConfig()` (e.g. the worker
loop) needs to change.

`GENTIC_API_KEY` and `GENTIC_API_URL` currently have no `.default(...)` —
that stays: if neither env nor config file provides them, `zod.parse`
throws today, and should keep throwing (with a message telling the user to
authenticate first, if you want to improve the error — nice-to-have, not
required).

### WORKDIR default

Note the current default is `/tmp/gentic-workspaces`, which is fine for a
dev checkout but not great for a long-running installed service (tmp
cleaners can wipe it mid-run). Consider changing the default to
`<envPaths.data>/workspaces` (i.e. `env-paths`'s `paths.data`, e.g.
`~/.local/share/gentic/workspaces` on Linux) — flag this as a decision for
whoever implements this spec to make and document in the PR description;
either choice is acceptable, but if you change it, update
`apps/gentic/readme.md`'s `.env.example` walkthrough to match.

## Non-goals

- No login/logout command yet — this task only builds the storage layer a
  future command will use.
- No secret-manager / OS-keychain integration. Plain file with `0o600` is
  the accepted tradeoff for now — native keychain bindings differ per
  platform and would complicate any future cross-platform binary build of
  this CLI. Revisit later if needed.

## Acceptance criteria

- Unit coverage (or at least manual verification) for `config-store.ts`:
  write then read round-trips, missing file returns `{}`, `writeConfigFile`
  merges rather than clobbers unrelated keys, file is created with `0o600`.
- `loadConfig()` still works with only `.env` set (today's dev workflow —
  no regression).
- `loadConfig()` also works with only the config file set and no relevant
  env vars.
- `loadConfig()` prefers env over the config file when both set the same
  key (write a test that sets both to different values and asserts the env
  value wins).
- `typecheck` and `lint` pass.
