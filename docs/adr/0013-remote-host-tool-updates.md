# 13. Remote host tool updates over the command channel

Date: 2026-09-23

## Status

Accepted

## Context

GEN-458 asks for a way to update the CLIs a host runs work with — gentic
itself, Claude Code, Codex and the GitHub CLI — from the Settings UI, instead
of shelling into every machine.

Three things shaped the design:

1. Hosts only ever make outbound requests. The skill-install feature already
   established a one-shot command channel for this: a transient row per
   command, claimed by the host on its 10-second control tick, with the
   result written back for the dialog that submitted it
   (`host_skill_installs`, ADR-free but documented in `docs/web/hosts.mdx`).
2. A gentic update replaces the code of the running process. The host has
   to restart to run it, but it may be in the middle of an agent session that
   the new binary cannot resume, and an in-flight session is worth far more
   than a prompt update.
3. The Claude Code that serves sessions is not the `claude` on PATH. It is
   the native CLI pinned by `@anthropic-ai/claude-agent-sdk` through
   `@agentclientprotocol/claude-agent-acp` (see `apps/gentic/src/tools.ts`
   and `claudeCliCommand` in `session.ts`), so `claude update` cannot move
   it.

## Decision

**Model updates as host commands, one table per command kind, and restart
the host only when it is idle.**

- `host_tool_updates` mirrors `host_skill_installs`: composite foreign key to
  `hosts (id, user_id)`, `waiting → updating → updated | failed | timed-out`,
  a lazy expiry sweep, RLS with no grants to `authenticated`. Several tools
  may be queued per host but the same tool only once (partial unique index
  on `(host_id, tool)`), and a host runs one update at a time (partial unique
  index on `host_id where status = 'updating'`). The claim takes the oldest
  waiting row.
- Each tool is updated the way onboarding installed it, with no shell:
  `claude update`; `brew upgrade gh` or the Linux package manager (`sudo -n`
  unless root); `brew upgrade codex` or `npm install -g @openai/codex@latest`;
  and for gentic the global package manager the running bundle was installed
  by (`npm`, `pnpm` or `bun`, detected from the module's own path). The
  standalone binary and a source checkout report the gentic update as
  unsupported rather than guessing at a download.
- Every result carries a one-line summary and the version observed after the
  update, so "Already up to date" and "Updated from X to Y" are facts the
  host measured, not inferences from an exit code. Output travels back only
  for failures and is scrubbed on both ends.
- After a successful update the host drops its cached tool check and
  heartbeats immediately, so Settings shows the new version within seconds.
- A gentic update that installed a different version sets a `restartPending`
  flag in the host loop. The loop stops claiming issues and review runs,
  keeps heartbeating and honouring control, and once no run is active exits
  with status **75** (EX_TEMPFAIL). The systemd unit restarts on failure and
  launchd's `KeepAlive` restarts on any exit, so both bring the host back on
  the new version; a foreground `gentic run` simply ends with a log line.
- Heartbeats now report the GitHub CLI alongside the two agent providers
  (`provider_capabilities.providers.github`, optional), because an update
  result needs a version to be read against. Older CLIs omit it and are
  unaffected.

## Consequences

- "Update Claude Code" moves the PATH CLI the operator logs in with, not the
  build that runs issues; the dialog says so, and "Update Gentic" is what
  refreshes the bundled build (an npm reinstall re-resolves the ACP adapter
  and its pinned SDK).
- The gentic update's "Updated" result arrives before the host actually runs
  the new version; the summary says the restart happens once active tasks
  finish. A host with long-running sessions can sit on the old version for a
  while, deliberately.
- Hosts that are not under a service manager exit on restart and stay down
  until started again. This matches how such hosts already behave on any
  exit, and the log line names the reason.
- Linux `gh` updates need passwordless sudo for the service user unless the
  host runs as root; a password prompt fails fast (`sudo -n`) with the reason
  in the result instead of hanging.
- Results outlive their run by an hour and are then purged: reopening the
  dialog shows what a recent update did, but Gentic still keeps no update
  history.
