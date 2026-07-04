# CLI framework and command scaffolding

## Context

`apps/gentic` is currently a single script: `src/index.ts` runs
`main()` unconditionally on load (it's an infinite poll loop — see the file
for the existing worker logic). There is no argv parsing, no subcommands,
and no `bin` entry in `package.json`. We want it to become a real CLI with
subcommands (an `auth` command, a `start`/`stop` service command, a
`status` command, more later), so before any of those commands can be
built we need a routing skeleton.

Read `apps/gentic/package.json`, `apps/gentic/src/index.ts`,
`apps/gentic/src/config.ts` before starting.

## Goal

Introduce `commander` and restructure the entrypoint so that:

- `gentic <command> [args]` dispatches to a command module.
- The *existing* worker loop behavior is preserved exactly, just moved
  behind a command (see below for which one).
- Adding a new command later is a one-file, one-line-of-registration change.
- Any command that talks to the user interactively has a consistent,
  pleasant look, via `@clack/prompts`.

## Non-goals

- Do not implement credential/login commands, service management
  (start/stop/restart-as-a-daemon), or a status dashboard in this task —
  those are separate efforts that build on top of what this task produces.
  This task only needs enough commands to prove the framework works.
- Do not touch how `config.ts` sources its values beyond what's described
  here — it stays env-var-only for now; a persisted config file is future
  work, not this task.
- Do not set up binary compilation or packaging.

## Design

### Dependencies

Add `commander` to `apps/gentic/package.json` dependencies (check the repo
for a pinned major version convention elsewhere; otherwise use the latest
`^12` or newer).

Also add `@clack/prompts`. Every command that talks to the user — login
prompts, service start/stop feedback, status output — should render
through it instead of raw `console.log`, so the CLI looks and feels like
one product instead of a pile of ad-hoc commands. Wire that up now, in
this task, even though `run` itself barely needs it, so nobody reaches for
`console.log` out of habit later.

### File layout

```
apps/gentic/src/
  cli.ts                 # new — the bin entry; builds the Command tree and parses argv
  index.ts                # trimmed — see below
  worker.ts               # new — the poll loop, extracted verbatim from index.ts's main()
  ui.ts                   # new — thin wrapper around @clack/prompts, see below
  commands/
    run.ts                 # new — registers `gentic run`, calls worker.ts's runWorker()
```

- `worker.ts`: move `main()`, `claimNextQueuedIssue`, `processIssue`,
  `fetchUserMessagesAfter`, and `describe` out of `index.ts` verbatim (no
  behavior changes), renaming `main` to `runWorker` and exporting it. It
  keeps its own `SIGINT`/`SIGTERM` handling exactly as today.
- `commands/run.ts`: exports a function `registerRunCommand(program:
  Command): void` that adds a `run` subcommand (hidden from `--help` is
  fine, or not — your call) whose action calls `await runWorker()`. This
  command matters beyond this task: it's the thing any later
  process-supervision tooling (systemd units, launchd plists, etc.) will
  invoke to run the worker in the foreground, so don't fold worker startup
  logic into anything named `start` — reserve `start` for a future command
  that *manages* a background service running `gentic run`, keep this one
  named `run`.
- `ui.ts`: a small shared surface so every command formats output the same
  way, instead of each command importing `@clack/prompts` directly and
  making its own styling choices. Re-export (or thinly wrap) at least:

  ```ts
  export { intro, outro, spinner, log, note, cancel, isCancel } from "@clack/prompts"
  export { text, password, confirm, select } from "@clack/prompts"
  ```

  Add one convention worth codifying here: any command that lets a prompt
  be cancelled (Ctrl+C at a `text`/`password`/`confirm` prompt) must check
  `isCancel(result)` and exit cleanly via `cancel("Cancelled.")` —
  `@clack/prompts` returns a symbol on cancel rather than throwing, and
  forgetting the check is the most common bug with this library. Document
  this in `ui.ts`'s module comment so whoever writes the next interactive
  command sees it.

  `run` itself (a long-lived poll loop, not a short interactive command)
  should keep using plain `console.log`/`console.error` for its ongoing
  worker output (today's `[gentic] ...` log lines) — `@clack/prompts` is
  for short-lived interactive/status commands, not a log stream. Don't
  route the worker loop's logging through `intro`/`outro`/spinners.
- `cli.ts`: creates a `commander` `Command` instance named `gentic`, reads
  version from `package.json`, registers each command module (currently
  just `run`), and calls `program.parseAsync(process.argv)`. Wrap the whole
  thing in a top-level catch that prints the error message and
  `process.exit(1)`, matching today's `main().catch(...)` behavior in
  `index.ts`.
- `index.ts`: keep it as a thin shim (`import "dotenv/config"; import
  "./cli"`) for now, or delete it and point `bin`/scripts straight at
  `cli.ts` — pick whichever is less churn, but make sure `dotenv/config` is
  still loaded before anything reads `process.env` (today `worker.ts`
  reads env directly the same way `index.ts` does now, so dotenv must load
  before `cli.ts`'s command tree executes).

### package.json changes

- Add `"bin": { "gentic": "./dist/cli.js" }` (or wherever the build output
  lands — check how `tsc`/`tsx` are used elsewhere in this package; if
  there's no build-to-JS step today because `tsx` runs `.ts` directly, keep
  `dev`/`start` scripts working via `tsx` against `src/cli.ts`, and treat
  `bin` as forward-looking for a future compiled-binary distribution rather
  than something that needs to resolve today).
- Update `scripts.dev` and `scripts.start` to point at `src/cli.ts run`
  instead of `src/index.ts`, so `pnpm --filter @gentic/gentic start` still
  boots the worker loop exactly as it does today (just routed through the
  new `run` command). This preserves the existing README instructions and
  the `pm2`/`systemd` examples in `apps/gentic/readme.md` — leave those
  examples alone in this task; a future task will replace them once real
  service-management commands exist.

## Acceptance criteria

- `pnpm --filter @gentic/gentic start` behaves identically to before this
  change (polls the API, clones repos, runs sessions) — no behavior
  regression, just re-routed through `cli.ts run`.
- `pnpm --filter @gentic/gentic dev -- run` (or equivalent) starts the
  worker loop.
- `node dist/cli.js --help` (or `tsx src/cli.ts --help`) lists `run` as an
  available command with a description.
- `pnpm --filter @gentic/gentic typecheck` and `lint` both pass.
- No existing exported behavior of `worker.ts`'s functions changed — this
  is a pure extraction/routing change.
- `src/ui.ts` exists and is what future commands are expected to import
  from rather than `@clack/prompts` directly.

## Notes on future config changes

`worker.ts` currently calls `loadConfig()` from `config.ts` directly inside
`runWorker()`. Leave that call as-is — a later task is expected to change
`config.ts`'s internals (adding a persisted config file as a source,
layered under environment variables) without changing its public
`loadConfig(): Config` signature, so this task shouldn't need to
anticipate that beyond not doing anything that would make such a change
awkward (e.g. don't inline config reads elsewhere, keep `loadConfig()` the
single entry point).
