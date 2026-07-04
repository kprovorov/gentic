# 05 — `gentic status` command

## Context

Depends on specs 01, 02, 03, 04 all being merged — this command is a thin
aggregator over things they already built. Read `src/config-store.ts`
(02), `src/commands/auth.ts`'s exported auth-state helper (03), and
`src/service/index.ts`'s `ServiceBackend` (04) before starting.

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

- Reuse spec 03's exported auth-state helper for the "Auth" line — do not
  re-implement reading the config store here.
- Reuse spec 04's `getServiceBackend().status()` for the "Service" line.
  Add whatever small extension to `ServiceBackend` is needed to also report
  uptime/pid if it doesn't already (e.g. `status(): Promise<{ state:
  "running" | "stopped" | "not-installed", pid?: number, since?: Date }>` —
  if spec 04 shipped a narrower `status()` return type, widen it here
  rather than duplicating a second status-checking code path).
- "Boot" line: whether the service is enabled at boot — add an
  `isEnabledOnBoot(): Promise<boolean>` to `ServiceBackend` if spec 04
  didn't already expose this.
- "Last run" line: call the existing `AgentApi` (see `src/api.ts`) for
  whatever endpoint already reports run state for issues owned by this
  key — check what's already fetched in `worker.ts` (spec 01's extraction
  of the old `index.ts`) and reuse the same API client construction
  (`createAgentApi`) rather than inventing a new one. If there's no
  "give me my most recent run" endpoint, this line degrading to "unknown
  (no API support yet)" is acceptable — don't add new server-side
  endpoints as part of this task; flag it as a follow-up in the PR
  description instead.
- If auth isn't configured at all, skip the service/last-run lines and
  just print `Auth: not configured — run "gentic auth login"` — no point
  showing a confusing partial status.
- `--json` flag for machine-readable output (useful for scripting/future
  dashboards) — nice-to-have, include if time allows, output the same
  fields as a flat JSON object.

## Acceptance criteria

- `gentic status` before `gentic auth login` clearly says auth isn't
  configured and suggests the fix, without crashing on missing service
  state.
- `gentic status` after `gentic auth login` + `gentic start` shows all
  four lines populated correctly, matching what `gentic auth status` (if
  it exists) and the service backend's own `status()` report independently
  — i.e. no drift between this command's numbers and the underlying
  sources of truth.
- `typecheck` and `lint` pass.
