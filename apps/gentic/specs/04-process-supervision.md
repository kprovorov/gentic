# Process supervision: `start` / `stop` / `restart` (auto-restart, start-on-boot)

## Context

### Prerequisites

This task assumes `apps/gentic` already has:

- `src/cli.ts` — a `commander`-based CLI entry with a command-registration
  pattern of roughly `export function register<Name>Command(program:
  Command): void`.
- `src/commands/run.ts` / a `gentic run` command that runs the worker loop
  in the foreground (blocking, no daemonization of its own). This is the
  command any service unit built by this task must invoke.
- `src/ui.ts` — a thin wrapper around `@clack/prompts` re-exporting
  `spinner`, `log`, and friends.

If any of these don't exist yet, create a minimal version first (a `run`
command that just calls the existing worker entrypoint in the foreground
is enough) rather than working around its absence — the rest of this task
depends on `gentic run` existing as the thing to supervise.

Today the README tells operators to wrap `pnpm --filter @gentic/gentic
start` in `pm2` or a hand-written `systemd` unit (see
`apps/gentic/readme.md`, "Production process example"). The ask is for
`gentic` itself to do this, so nobody needs pm2 installed separately, and
so a packaged install (Homebrew/apt) is self-sufficient.

## Goal

`gentic start` / `gentic stop` / `gentic restart` and a service-state
query that a separate status command can call into later (see "Exposed
state" below) that:

- Install and manage a **real OS service** so crashes auto-restart and the
  worker starts on boot, using the platform's native service manager. This
  is a deliberate choice over hand-rolled daemonization (a hand-rolled
  detached-process+pidfile daemon can't give you crash-restart or
  boot-start on its own — the OS's service manager already solves both, so
  we lean on it instead of reinventing it).
- Fall back to a best-effort detached-process mode where no native service
  manager is available, clearly telling the user it won't survive reboot
  or auto-restart on crash.

**Important naming**: the service's `ExecStart`/`ProgramArguments` must
invoke `gentic run` (the existing foreground worker command), never
`gentic start` — `start` is the management command in this task, `run` is
the thing being managed. Don't create a recursive relaunch.

## Design

### Platform backends

Create `src/service/` with one module per backend and a small interface:

```ts
export interface ServiceBackend {
  isAvailable(): boolean
  install(opts: { enableOnBoot: boolean }): Promise<void> // writes unit/plist, reloads manager
  uninstall(): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
  status(): Promise<{ state: "running" | "stopped" | "not-installed"; pid?: number; since?: Date }>
  isEnabledOnBoot(): Promise<boolean>
  logs(opts: { follow: boolean }): Promise<void> // streams to stdout
}
```

(The richer `status()` return type and `isEnabledOnBoot()` are there so a
future status-summary command can query real state instead of re-deriving
it — export them even though this task's own commands may only use part of
what they return.)

- **`src/service/systemd.ts`** (Linux): user-level unit at
  `~/.config/systemd/user/gentic.service` by default (no root needed):

  ```ini
  [Unit]
  Description=Gentic agent worker
  After=network-online.target

  [Service]
  ExecStart=<absolute path to the gentic binary/entry> run
  Restart=on-failure
  RestartSec=5
  Environment=NODE_ENV=production

  [Install]
  WantedBy=default.target
  ```

  `install()` writes the file, runs `systemctl --user daemon-reload`, and
  if `enableOnBoot` also runs `systemctl --user enable gentic.service`
  (note: user units need `loginctl enable-linger <user>` to actually start
  at boot before login — call that too when `enableOnBoot` is set, and
  surface a clear error if it fails, e.g. no permission, suggesting the
  system-level unit instead). `start`/`stop`/`restart`/`status` shell out
  to `systemctl --user <verb> gentic.service` and parse
  `systemctl --user is-active gentic.service`. `logs` shells to
  `journalctl --user -u gentic.service -f` (or without `-f` per `follow`).

  Also support a `--system` flag on `gentic start` (plumbed through from
  the command layer, not this backend's problem beyond accepting a
  `scope: "user" | "system"` option) that targets
  `/etc/systemd/system/gentic.service` via plain `systemctl` (no `--user`)
  — this is what a package-manager postinstall script would want, since
  those installs typically run as root and should offer a system-wide
  service. Extend the `ServiceBackend` interface/constructor to take this
  scope rather than hardcoding user-mode.

  `isAvailable()`: check `which systemctl` (or `fs.existsSync` on a known
  systemd marker) succeeds.

- **`src/service/launchd.ts`** (macOS): plist at
  `~/Library/LaunchAgents/dev.gentic.agent.plist`:

  ```xml
  <?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0">
  <dict>
    <key>Label</key><string>dev.gentic.agent</string>
    <key>ProgramArguments</key>
    <array><string>/path/to/gentic</string><string>run</string></array>
    <key>KeepAlive</key><true/>
    <key>RunAtLoad</key><true/>
    <key>StandardOutPath</key><string>~/Library/Logs/gentic/gentic.log</string>
    <key>StandardErrorPath</key><string>~/Library/Logs/gentic/gentic.log</string>
  </dict>
  </plist>
  ```

  `KeepAlive=true` gives auto-restart, `RunAtLoad=true` gives start-on-load
  (launchd's equivalent of boot-start for a LaunchAgent loaded at login).
  `install()`/`start()` use `launchctl bootstrap gui/<uid>
  ~/Library/LaunchAgents/dev.gentic.agent.plist` (or the older `load -w` if
  you need to support older macOS — check what's reasonable to target);
  `stop()`/`uninstall()` use `bootout`. `logs()` tails the log file path
  above since launchd doesn't have a `journalctl` equivalent.

  `isAvailable()`: `process.platform === "darwin"`.

- **`src/service/fallback.ts`** (anything else — e.g. containers without
  systemd): detached child process + pidfile, explicitly best-effort:

  - `install()`/`start()`: `spawn(process.execPath, [genticEntry, "run"], {
    detached: true, stdio: ["ignore", logFd, logFd] }).unref()`, write PID
    to `<dataDir>/gentic.pid`, where `<dataDir>` comes from the
    `env-paths` package (`envPaths("gentic").data`) — add `env-paths` as a
    dependency if it isn't already one; check `package.json` first so you
    don't add a second, inconsistent way of computing per-OS data
    directories if one already exists in the repo.
  - `status()`: read the pidfile, check liveness with `process.kill(pid,
    0)` (catch ESRCH → stopped, clean up stale pidfile).
  - `stop()`: `process.kill(pid, "SIGTERM")`, wait briefly, remove pidfile.
  - No `enableOnBoot` support — if requested, print a clear warning that
    this platform has no native service manager available and boot-start
    isn't possible in fallback mode.
  - `isAvailable()`: always `true` (last resort).

### Backend selection

`src/service/index.ts` exports `getServiceBackend(opts?: { scope?: "user" |
"system" }): ServiceBackend`, picking systemd on Linux, launchd on macOS,
else fallback. `--system` scope only makes sense for the systemd backend;
error clearly if passed elsewhere.

### Commands

`src/commands/start.ts`, `stop.ts`, `restart.ts` (or one `service.ts` file
registering all three plus a shared `--system` flag — implementer's call,
keep it simple). `start` accepts `--no-boot` to skip the boot-enable step
(default is boot-enabled — the whole point of this feature is that it
works without extra flags for the common case, so someone doesn't need
pm2 or a hand-written systemd unit just to keep the worker alive).

Render each command's progress through a spinner instead of plain
`console.log` — these are short-lived one-shot commands, exactly what
`@clack/prompts` is for. If the repo already has a `src/ui.ts` wrapper
around `@clack/prompts` (exporting `spinner`, `log`, etc.), import from
there; otherwise add `@clack/prompts` as a dependency and use it directly:

```ts
const s = spinner()
s.start("Starting gentic service")
await backend.install({ enableOnBoot })
await backend.start()
s.stop("gentic is running")
```

Use a styled `log.error(...)`/`log.warn(...)` for failures — e.g. the
`loginctl enable-linger` failure case above, or "no native service manager
found, falling back to detached-process mode" — instead of
`console.error`, so this command's output matches the rest of the CLI.

Update `apps/gentic/readme.md`'s "Production process example" section to
replace the pm2/systemd hand-rolled examples with `gentic start` /
`gentic stop` / `gentic restart`, keeping a short note that `gentic run`
still exists for foreground/dev use (what `pnpm --filter @gentic/gentic
start` continues to run).

### Exposed state (for a future status command)

Don't build a full status dashboard here — just make sure
`getServiceBackend().status()` and `.isEnabledOnBoot()` return enough to
answer "is it running, since when, is it set to survive a reboot" for
whatever aggregates that later.

## Acceptance criteria

- On a Linux dev box with systemd (check what's available in this repo's
  CI/sandbox — if no systemd is available for testing, note that clearly
  in the PR and provide a way to verify by inspecting the generated unit
  file's contents rather than actually starting it): `gentic start`
  installs and starts a user unit, its status query reports "running",
  killing the process externally causes systemd to restart it within
  `RestartSec`, `gentic stop` stops it and it stays stopped, `gentic
  restart` bounces it.
- `gentic start --no-boot` does not call `systemctl --user enable`
  /`launchctl` load-at-login equivalent.
- Fallback backend works when `systemctl`/`launchctl` are unavailable
  (e.g. force it in a test by stubbing `isAvailable()`).
- Uninstalling/stopping cleans up unit files / pidfiles — no orphaned
  service definitions left behind (consider whether `stop` should also
  `uninstall()`, or whether a separate verb is needed; document your
  choice).
- `typecheck` and `lint` pass.
