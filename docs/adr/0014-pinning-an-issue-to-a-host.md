# 14. Pinning an issue to a host

Date: 2026-09-24

## Status

Accepted

## Context

GEN-464 asks for a way to choose the host when creating an issue. Until now
every issue sat on one account-wide queue and `claimNextQueuedIssue` handed
it to whichever eligible host polled first, ordered by priority and then age.
Nothing on an issue named a machine except `active_host_id`, and that is a
run lease: it is set when a host claims the issue and cleared by
`release_issue_run_lease` the moment the run leaves `queued`/`in-progress`
(ADR-0003), so it cannot carry a preference across runs.

A preference has to be honoured by the claim path, which is a TypeScript
compare-and-swap in `apps/web/app/api/v1/agent/issues/claim/route.ts` rather
than a SQL RPC: a candidate select followed by a conditional update that
repeats every eligibility predicate. It also has to survive the lifecycle
functions that touch host assignment — `requeue_host_active_issues`,
`ban_host`, `delete_host` and `reconcile_offline_host_runs` — each of which
was written when the only host column was the lease.

## Decision

**A new nullable column, `issues.pinned_host_id`, records the choice; it is
a hard constraint, not a hint.** When set, only that host may claim the issue.
A soft "prefer this host but fall back" would need a timeout policy nobody
asked for and would make the wait invisible; a hard pin is what "choose a
host" means to the person choosing, and the detail page shows the pin so a
waiting issue explains itself.

**The pin is separate from the lease and outlives it.** `active_host_id`
keeps its meaning of "running there right now". The pin survives requeues,
resets, the offline reconciler and bans, because it records what the user
asked for rather than what is currently happening; none of the lifecycle
functions were changed. It is cleared in exactly one case — the pinned host
is deleted — and that is done by the foreign key (`on delete set null`), so
`delete_host` needs no new code and the issue falls back to the shared queue
rather than waiting for a host that will never return.

**Banning does not unpin.** A ban is reversible (`unban_host` exists) and is
usually short; silently moving pinned work elsewhere would undo the user's
choice. The requeue that a ban already performs sends the issue back to
`todo`, where it waits for that host. The reverse direction is guarded
instead: creating or changing a pin to a banned host is rejected
(`ensureHostPinnable`), and the pickers leave banned hosts out, while an
existing pin to a since-banned host stays editable so it can be removed.

**Enforcement lives in the claim route, on both halves of the
compare-and-swap.** `pinned_host_id.is.null,pinned_host_id.eq.<host>` is
applied as its own `or` group — PostgREST ANDs separate `or` parameters —
to the candidate select and again to the conditional update, so a pin that
lands between the two reads is respected the same way a status change is.
The host CLI is untouched: it still sends an empty claim body, and the host
identity comes from the credential.

**Ownership is checked in the service, not the database.** `createIssue` and
`updateIssue` verify the host belongs to the caller before writing the pin,
matching how labels and projects are authorised for the secret-key clients
(agent API, MCP) that bypass RLS.

## Consequences

- `issues` now has two foreign keys to `hosts`, so every PostgREST embed of
  `hosts` from `issues` must name its key (`hosts!issues_active_host_id_fkey`).
  The one existing embed, in the home issues query, was updated; a bare
  `hosts(...)` embed will fail at runtime with an ambiguity error.
- The new-issue composer gains a **Host** pill and the edit page a **Host**
  select, both reading the Settings page's cached hosts query. The pill is not
  persisted with the other composer settings, since a sticky pin would quietly
  route every later issue to one machine.
- The MCP `create_issue`/`update_issue` tools accept no pin yet: there is no
  MCP tool that lists hosts, so a client could not obtain an id to pass.
  `get_issue` does return `pinned_host_id`, since it returns the row.
- A pinned issue whose host stays offline waits indefinitely and shows as
  `Todo`; nothing escalates it. That is the documented behaviour, and the
  detail page's **Pinned to** line is the signal to change or remove the pin.
