# Gentic CLI — spec overview

Turns the `apps/gentic` worker into an installable CLI (`gentic auth`,
`gentic start`, `gentic status`, ...) distributed as a standalone binary via
Homebrew and apt. Each numbered spec in this directory is scoped to be handed
to a separate implementing agent with no other context beyond the spec file
and the current repo.

## Reading order for implementers

Every spec assumes the specs it depends on are already merged. Give an agent
the spec file plus a note on which branch/commit to base on.

## Task list and dependencies

| # | Spec | Depends on | Can run in parallel with |
|---|------|-----------|---------------------------|
| 1 | [01-cli-framework.md](./01-cli-framework.md) | — | — (do this first, alone) |
| 2 | [02-config-store.md](./02-config-store.md) | 1 | 4, 6 |
| 3 | [03-auth-command.md](./03-auth-command.md) | 1, 2 | 4, 6 |
| 4 | [04-process-supervision.md](./04-process-supervision.md) | 1 | 2, 3, 6 |
| 5 | [05-status-command.md](./05-status-command.md) | 1, 2, 3, 4 | — |
| 6 | [06-standalone-binary.md](./06-standalone-binary.md) | 1 | 2, 3, 4 |
| 7 | [07-packaging-distribution.md](./07-packaging-distribution.md) | 6 (soft: 3, 4, 5) | — |

Recommended rollout:

1. Land **01** by itself first — everything else edits files it creates.
2. Fan out **02**, **04**, **06** to three agents in parallel.
3. Once **02** merges, run **03**.
4. Once **02**, **03**, **04** are all merged, run **05**.
5. Once **06** merges (ideally after 03/04/05 too, so the compiled binary is
   feature-complete), run **07**.

## Cross-cutting decisions already made (don't relitigate these in each spec)

- **CLI framework**: [commander](https://www.npmjs.com/package/commander).
  Reason: zero-config subcommand routing, TS types ship in the package,
  battle-tested, no runtime surprises for a compiled binary.
- **Entry point split**: `src/cli.ts` becomes the `bin` entry (parses argv,
  registers commands). `src/index.ts`'s current poll loop becomes a plain
  exported function consumed by the `run` command — it is no longer the
  thing that executes on require.
- **Config precedence**: environment variables > persisted config file >
  built-in defaults. `.env` keeps working for local dev (loaded by
  `dotenv/config` as today); the config file is what `gentic auth` writes to
  and what an installed binary uses in production.
- **Process supervision uses the OS's own service manager** (systemd user
  units on Linux, launchd on macOS) as the primary mechanism, because that's
  what actually gets you crash-restart and start-on-boot for free. A
  detached-process+pidfile mode is a fallback only for environments without
  either (e.g. some containers), and is explicitly best-effort (no
  restart-on-crash, no boot-start).
- **Binary compiler**: `bun build --compile`, not Node's Single Executable
  Application feature — see spec 06 for why.

## Naming

Package/binary name: `gentic`. Homebrew tap: `kprovorov/homebrew-gentic`
(placeholder — confirm before spec 07 ships a formula pointing at it).
