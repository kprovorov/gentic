# `gentic status` command

## Context

### Prerequisites

This task assumes `apps/gentic` already has:

- `src/config-store.ts` and an auth module (e.g. `src/commands/auth.ts`)
  exporting some form of `getAuthState()` that reports whether credentials
  are configured (and, ideally, a masked key + API URL) by reading the
  persisted config store. If no such helper exists yet, read
  `src/config-store.ts` directly (`readConfigFile()`) and derive the same
  information inline rather than blocking on it.
- `src/service/index.ts` exporting `getServiceBackend(): ServiceBackend`
  with a `status(): Promise<{ state: "running" | "stopped" |
  "not-installed"; pid?: number; since?: Date }>` and an
  `isEnabledOnBoot(): Promise<boolean>`. If the real shape differs (e.g. a
  narrower `status()` return type), widen it as needed rather than
  duplicating a second status-checking code path.
- `src/ui.ts` — a thin wrapper around `@clack/prompts` re-exporting `note`,
  `log`, etc. If missing, add `@clack/prompts` as a dependency and use it
  directly.
- `src/api.ts` exporting `createAgentApi` and an `AgentApi` interface for
  talking to the hosted Gentic API.

## Goal

One command a user runs to answer "is gentic working right now":

```
$ gentic status
Auth:     configured (api key: sk-...ab12, url: https://gentic.chat/api/v1)
Service:  running (systemd --user, pid 12345, up 3h 12m)
Boot:     enabled
Last run: issue 4f2a... completed 2026-07-04T10:02:11Z
```

## Design

### Rendering

Render through `note()` (wrapping `@clack/prompts`, via `src/ui.ts` if it
exists) rather than plain `console.log`, so the output reads as one styled
block instead of loose log lines:

```ts
import { note, log } from "../ui"

note(
  [
    `Auth:     ${authLine}`,
    `Service:  ${serviceLine}`,
    `Boot:     ${bootLine}`,
    `Last run: ${lastRunLine}`,
  ].join("\n"),
  "gentic status"
)
```

Use `log.warn(...)` for the "not configured" case instead of folding it
into the `note()` box, so it's visually distinct from a healthy status
block. Keep `--json` (see below) completely unstyled — plain
`console.log(JSON.stringify(...))`, no prompt-library output involved,
since scripts consuming `--json` shouldn't have to strip decoration.

### Data sources

- "Auth" line: reuse whatever auth-state helper already exists (see
  Prerequisites) for reading configured credentials — do not re-implement
  reading the config store here.
- "Service" line: reuse `getServiceBackend().status()` for running state,
  pid, and uptime.
- "Boot" line: reuse `getServiceBackend().isEnabledOnBoot()`.
- "Last run" line: call the existing `AgentApi` (see `src/api.ts`) for
  whatever endpoint already reports run state for issues owned by this
  key — check what's already fetched by the worker loop and reuse the same
  API client construction (`createAgentApi`) rather than inventing a new
  one. If there's no "give me my most recent run" endpoint, this line
  degrading to "unknown (no API support yet)" is acceptable — don't add
  new server-side endpoints as part of this task; flag it as a follow-up
  in the PR description instead.
- If auth isn't configured at all, skip the service/last-run lines and
  just print `Auth: not configured — run "gentic auth login"` — no point
  showing a confusing partial status.
- `--json` flag for machine-readable output (useful for scripting/future
  dashboards) — nice-to-have, include if time allows, output the same
  fields as a flat JSON object.

## Acceptance criteria

- `gentic status` before any credentials are configured clearly says auth
  isn't configured and suggests the fix, without crashing on missing
  service state.
- `gentic status` after credentials are configured and the service is
  started shows all four lines populated correctly, matching what the
  underlying auth-state helper and service backend report independently —
  i.e. no drift between this command's numbers and the underlying sources
  of truth.
- `typecheck` and `lint` pass.
