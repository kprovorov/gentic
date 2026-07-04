# `gentic auth` command

## Context

### Prerequisites

This task assumes the following already exist in `apps/gentic`; read each
before starting, and if any is missing, create a minimal version of it
first (following the shape below) rather than working around its absence:

- `src/cli.ts` — a `commander`-based CLI entry with a command-registration
  pattern of roughly `export function register<Name>Command(program:
  Command): void`, called from `cli.ts` to build the command tree.
- `src/config-store.ts` — a small module for a persisted, per-user JSON
  config file, exporting at least:
  ```ts
  export function configFilePath(): string
  export function readConfigFile(): ConfigFile // {} if no file yet
  export function writeConfigFile(patch: Partial<ConfigFile>): void
  export function clearConfigFile(): void
  ```
  where `ConfigFile` has optional `GENTIC_API_KEY` and `GENTIC_API_URL`
  fields (plus possibly others, e.g. `GIT_REMOTE_BASE`, `WORKDIR`,
  `POLL_INTERVAL_MS`) mirroring the env vars `src/config.ts` already
  validates via `zod`.
- `src/ui.ts` — a thin wrapper around `@clack/prompts` re-exporting
  `intro`, `outro`, `spinner`, `log`, `note`, `cancel`, `isCancel`, `text`,
  `password`, `confirm`, `select`. If it doesn't exist, add `@clack/prompts`
  as a dependency and create this wrapper as part of this task rather than
  importing `@clack/prompts` directly from the command file.
- `src/api.ts` — exports `createAgentApi` / an `AgentApi` interface used to
  talk to the hosted Gentic API.

## Goal

A `gentic auth` command group that lets a user configure credentials
without hand-editing files:

- `gentic auth login` — interactively prompts for `GENTIC_API_URL` (default
  `https://gentic.chat/api/v1`) and `GENTIC_API_KEY`, validates the key
  against the real API, then persists both via `config-store.ts`'s
  `writeConfigFile()`.
- `gentic auth login --api-url <url> --api-key <key>` — same, non-interactive
  (for scripting/CI), no prompts.
- `gentic auth logout` — asks for confirmation via `ui.ts`'s `confirm()`
  (skip the prompt with a `--yes`/`-y` flag for scripting), then calls
  `clearConfigFile()` (or removes just the auth keys — your call, document
  which) and prints confirmation via `log.success(...)`.
- `gentic auth status` — prints whether credentials are configured and, if
  so, the masked key (`sk-...abcd`, last 4 chars only) and the API URL in
  use. Keep this narrow — a fuller "is everything healthy" dashboard
  (auth + running service + last processed issue) may be built as a
  separate command later; don't try to build that here. Export a small
  `getAuthState()` helper from this module (reading via `config-store.ts`)
  so a future richer status command can reuse it instead of
  re-implementing config reads.

## Design

### Validating the key

Look at `src/api.ts`'s `createAgentApi` / `AgentApi` interface. Find (or
add, if none exists) a cheap authenticated endpoint to call as a
"does this key work" check — claiming an issue is not appropriate (it has
side effects). If the hosted API has no read-only authenticated endpoint
suitable for a health check, adding one server-side is out of scope for
this task; instead do the minimal validation available (e.g. a `GET` that
lists projects/issues without claiming) and clearly log if no such check
exists, falling back to "saved without validation, will fail on first poll
if wrong." Flag whichever path you took in the PR description — this is a
judgment call that depends on what the Gentic API actually exposes; look
at the API's server-side code in this monorepo before assuming.

### Interactive prompts

Use `@clack/prompts` via `src/ui.ts` (see Prerequisites above — import
from `ui.ts`, not `@clack/prompts` directly):

```ts
import { intro, outro, text, password, confirm, isCancel, cancel, spinner } from "../ui"

intro("gentic auth login")

const apiUrl = await text({
  message: "Gentic API URL",
  defaultValue: "https://gentic.chat/api/v1",
  placeholder: "https://gentic.chat/api/v1",
})
if (isCancel(apiUrl)) return cancel("Cancelled.")

const apiKey = await password({
  message: "Gentic API key",
  validate: (v) => (v.length === 0 ? "API key is required" : undefined),
})
if (isCancel(apiKey)) return cancel("Cancelled.")

const s = spinner()
s.start("Validating key")
// ... call the API health-check from "Validating the key" above ...
s.stop("Key looks valid")

outro(`Saved to ${configFilePath()}`)
```

`password()` handles input masking for you (renders `•` characters) — this
is the actual reason to use `@clack/prompts` here instead of hand-rolling
with `node:readline/promises`, which has no built-in masked input. Use
`spinner()` around the API validation call so a slow/hanging network
request doesn't look like the CLI froze.

`--api-url`/`--api-key` flags must fully bypass all of the above — no
`intro`/`outro`/spinner output, no prompts, just validate-and-save then
print a single-line confirmation, so `gentic auth login --api-url ...
--api-key ...` stays script-friendly (parseable/quiet output, non-zero
exit on failure).

### Command file

`src/commands/auth.ts`, exporting `registerAuthCommand(program: Command):
void`, adding an `auth` command with `login`/`logout`/`status`
subcommands, following the same registration pattern used by any existing
command in `src/commands/` (e.g. `run`).

## Acceptance criteria

- `gentic auth login` (no flags) prompts for URL then key, writes them via
  the config store, and prints a success message including where the file
  was written (`configFilePath()`).
- `gentic auth login --api-url ... --api-key ...` does the same
  non-interactively with no prompts, suitable for scripting.
- `gentic auth logout` clears stored credentials and confirms.
- `gentic auth status` never prints the raw API key.
- Existing env-var-only workflow (`.env` with `GENTIC_API_KEY` set,
  `gentic run` invoked directly) still works untouched — `auth` is
  additive, not required.
- `typecheck` and `lint` pass.
