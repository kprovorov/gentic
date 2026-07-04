# 01 — CLI framework and command scaffolding

## Context

`apps/gentic` is currently a single script: `src/index.ts` runs
`main()` unconditionally on load (it's an infinite poll loop — see the file
for the existing worker logic). There is no argv parsing, no subcommands,
and no `bin` entry in `package.json`. We want it to become a real CLI with
subcommands (`gentic auth`, `gentic start`, `gentic status`, more later),
so before any of those commands can be built we need a routing skeleton.

Read `apps/gentic/package.json`, `apps/gentic/src/index.ts`,
`apps/gentic/src/config.ts` before starting.

## Goal

Introduce `commander` and restructure the entrypoint so that:

- `gentic <command> [args]` dispatches to a command module.
- The *existing* worker loop behavior is preserved exactly, just moved
  behind a command (see below for which one).
- Adding a new command later is a one-file, one-line-of-registration change.

## Non-goals

- Do not implement `auth`, `status`, `start`/`stop`/`restart`, or the daemon
  supervision logic in this task — those are separate specs (02-05). This
  task only needs enough commands to prove the framework works.
- Do not change `config.ts`'s env-only behavior yet (spec 02 replaces it).
- Do not set up binary compilation (spec 06).

## Design

### Dependencies

Add `commander` to `apps/gentic/package.json` dependencies (check the repo
for a pinned major version convention elsewhere; otherwise use the latest
`^12` or newer).

### File layout

```
apps/gentic/src/
  cli.ts                 # new — the bin entry; builds the Command tree and parses argv
  index.ts                # trimmed — see below
  worker.ts               # new — the poll loop, extracted verbatim from index.ts's main()
  commands/
    run.ts                 # new — registers `gentic run`, calls worker.ts's runWorker()
```

- `worker.ts`: move `main()`, `claimNextQueuedIssue`, `processIssue`,
  `fetchUserMessagesAfter`, and `describe` out of `index.ts` verbatim (no
  behavior changes), renaming `main` to `runWorker` and exporting it. It
  keeps its own `SIGINT`/`SIGTERM` handling exactly as today.
- `commands/run.ts`: exports a function `registerRunCommand(program:
  Command): void` that adds a `run` subcommand (hidden from `--help` is
  fine, or not — your call) whose action calls `await runWorker()`. This is
  the command systemd/launchd units will invoke in the foreground (spec 04
  depends on this existing). Do not call it `start` — `start` is reserved
  for the process-supervision command in spec 04 that *manages* a
  background service running `gentic run`.
- `cli.ts`: creates a `commander` `Command` instance named `gentic`, reads
  version from `package.json`, registers each command module (currently
  just `run`), and calls `program.parseAsync(process.argv)`. Wrap the whole
  thing in a top-level catch that prints the error message and
  `process.exit(1)`, matching today's `main().catch(...)` behavior in
  `index.ts`.
- `index.ts`: keep it as a thin shim (`import "dotenv/config"; import
  "./cli"`) for now, or delete it and point `bin`/scripts straight at
  `cli.ts` — pick whichever is less churn, but make sure `dotenv/config` is
  still loaded before anything reads `process.env` (config loading happens
  inside command actions, i.e. lazily, in spec 02 — for this task
  `worker.ts` still reads env directly like today, so dotenv must load
  before `cli.ts`'s command tree executes).

### package.json changes

- Add `"bin": { "gentic": "./dist/cli.js" }` (or wherever the build output
  lands — check how `tsc`/`tsx` are used elsewhere in this package; if
  there's no build-to-JS step today because `tsx` runs `.ts` directly, keep
  `dev`/`start` scripts working via `tsx` against `src/cli.ts`, and treat
  `bin` as forward-looking for spec 06's compiled-binary work rather than
  something that needs to resolve today).
- Update `scripts.dev` and `scripts.start` to point at `src/cli.ts run`
  instead of `src/index.ts`, so `pnpm --filter @gentic/gentic start` still
  boots the worker loop exactly as it does today (just routed through the
  new `run` command). This preserves the existing README instructions and
  the `pm2`/`systemd` examples in `apps/gentic/readme.md` (spec 04 will
  update those examples once `start`/`stop` exist for real).

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

## Notes for the next agent (spec 02)

`worker.ts` currently calls `loadConfig()` from `config.ts` directly inside
`runWorker()`. Leave that as-is here; spec 02 changes `config.ts`'s
internals (adds the persisted config file layer) without changing its
public `loadConfig(): Config` signature, so this task and spec 02 shouldn't
conflict.
