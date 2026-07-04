# 03 — `gentic auth` command

## Context

Depends on spec 01 (CLI framework) and spec 02 (config store) being merged.
Read both specs and the resulting `src/cli.ts`, `src/config-store.ts`,
`src/config.ts`, `src/api.ts` before starting.

## Goal

A `gentic auth` command group that lets a user configure credentials
without hand-editing files:

- `gentic auth login` — interactively prompts for `GENTIC_API_URL` (default
  `https://gentic.chat/api/v1`) and `GENTIC_API_KEY`, validates the key
  against the real API, then persists both via `writeConfigFile()` from
  spec 02.
- `gentic auth login --api-url <url> --api-key <key>` — same, non-interactive
  (for scripting/CI), no prompts.
- `gentic auth logout` — calls `clearConfigFile()` (or removes just the auth
  keys — your call, document which) and confirms.
- `gentic auth status` (or fold into spec 05's `gentic status` instead —
  see "Overlap with spec 05" below) — prints whether credentials are
  configured and, if so, the masked key (`sk-...abcd`, last 4 chars only)
  and the API URL in use.

## Design

### Validating the key

Look at `src/api.ts`'s `createAgentApi` / `AgentApi` interface. Find (or
add, if none exists) a cheap authenticated endpoint to call as a
"does this key work" check — claiming an issue is not appropriate (it has
side effects). If the hosted API has no read-only authenticated endpoint
suitable for a health check, add one server-side is out of scope for this
task; instead do the minimal validation available (e.g. a `GET` that lists
projects/issues without claiming) and clearly log if no such check exists,
falling back to "saved without validation, will fail on first poll if
wrong."  Flag whichever path you took in the PR description — this is a
judgment call that depends on what the API in `apps/web` (or wherever the
Gentic API lives in this monorepo) actually exposes; look there before
assuming.

### Interactive prompts

Use Node's built-in `node:readline/promises` for the two prompts (URL, then
key with input masked if feasible — masking raw stdin input in a portable
way is fiddly; if `commander` or a small, already-broadly-used prompt
helper is cheaper and doesn't fight spec 06's bundling, that's an
acceptable substitution, but avoid pulling in a heavy interactive-CLI
framework for two prompts).

### Command file

`src/commands/auth.ts`, exporting `registerAuthCommand(program: Command):
void`, adding an `auth` command with `login`/`logout`/`status`
subcommands, following the same registration pattern spec 01 established
for `run`.

## Overlap with spec 05

Spec 05 (`gentic status`) is meant to be the one place a user checks
overall health (auth + service + last run). Don't duplicate a full status
dashboard here — `gentic auth status` (if you implement it) should be a
narrow "is a key configured" check; `gentic status` in spec 05 is the rich
version and may internally reuse a helper you export from
`src/commands/auth.ts` (e.g. `getAuthState()`) rather than shelling out to
itself. Export such a helper if practical.

## Acceptance criteria

- `gentic auth login` (no flags) prompts for URL then key, writes them via
  the spec-02 config store, and prints a success message including where
  the file was written (`configFilePath()`).
- `gentic auth login --api-url ... --api-key ...` does the same
  non-interactively with no prompts, suitable for scripting.
- `gentic auth logout` clears stored credentials and confirms.
- `gentic auth status` (or the equivalent) never prints the raw API key.
- Existing env-var-only workflow (`.env` with `GENTIC_API_KEY` set,
  `gentic run` invoked directly) still works untouched — `auth` is
  additive, not required.
- `typecheck` and `lint` pass.
