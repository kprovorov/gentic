# 3. Implementation-session ownership for review fixes

Date: 2026-08-19

## Status

Accepted

## Context

When an Issue's coding agent produces pull-request changes, review feedback
(changes-requested reviews, PR comments, failing CI) must go back to the *same*
agent session that wrote them — the one whose local checkout and resumable ACP
session can push fixes to the same branch. The existing machinery could not
guarantee that.

The only ownership token was the run **lease** (`issues.active_run_id` +
`active_worker_id`), and it is deliberately transient: `release_issue_run_lease`
clears it the moment a run leaves `queued`/`in-progress`, and any eligible
worker can then claim a re-queued Issue. `issues.session_id` (the ACP resume
handle) survived across runs, but it is free-text, unscoped to a worker, and
overwritten by whichever run persists next. So a review fix could silently land
on a *different* worker with no checkout to resume — or the original owner could
be lost to a lease expiry with nothing recording who it had been.

## Decision

Record a durable, addressable **implementation owner** per Issue in a new table
`issue_implementation_owners`. One current (non-superseded) row per Issue holds
the owning `worker_id` (the stable machine identity, unlike the lease), the
`session_id` to resume, the `agent_provider`/`issue_model` the session runs, a
monotonic `generation`, and an `origin` (`implementation` or
`fresh_implementation`).

**Establishment and refresh are automatic**, via the `security definer`
`sync_issue_implementation_owner` trigger on `issues`:

- Persisting a session on a live run (lease held) with no current owner
  establishes generation 1, bound to that worker.
- The **owning** worker persisting a session again — after a reconnect, service
  restart, lease expiry, or review retry — refreshes the resume handle on the
  same generation. Ownership is therefore resolvable after any of those events.
- A **different** worker running the Issue never takes ownership implicitly, so
  worker reassignment cannot move the implementation owner.
- Clearing `session_id` (what `reset_issue_run` and an agent-provider change do)
  supersedes the current owner; the next run establishes a fresh generation.

**Resumability is derived, not stored.** `resolveImplementationOwner`
(`@gentic/services/issues`) joins the live worker and Issue rows and computes
whether the owner can be resumed, returning a stable reason code when it cannot:
`provider_changed`, `session_missing`, `worker_deleted`, or `worker_banned`.
Deriving means ban/delete/offline and provider changes are reflected the instant
they happen, with no fan-out writes to keep this table consistent — the reason
codes are suitable for driving UI recovery controls.

**Fresh implementation is an explicit user action**, never a fallback.
`start_fresh_implementation` runs under `for update` on the Issue: it supersedes
the current owner, establishes a new unbound generation (`fresh_implementation`),
audits the transition as an `implementation_ownership_reset` issue event, and
clears the session and run lease while re-queueing the Issue. Because the lease
is cleared under the lock, a late resume of the old owner and a fresh
implementation cannot both win — the loser's run-state writes are rejected — so
concurrent recovery resolves to a single owner atomically.

**Handoffs are validated against the owner.** `validateFixHandoff` accepts a fix
only when the target worker/session (and, optionally, generation) matches the
current owner *and* the owner is resumable. Any other target is rejected as
`not_owner`, and an unavailable owner surfaces its reason code — leaving the
Issue to wait for human action rather than silently picking a new owner.

## Consequences

- Review fixes have a durable, single, addressable target that survives worker
  reconnects, service restarts, lease expiry, and review retries.
- Unavailable ownership is a first-class, machine-readable state, so recovery is
  a human decision (a fresh implementation) rather than an implicit reassignment.
- This layer records and validates ownership; it does not execute reviewers,
  route claims to the owning worker, spawn a replacement agent, or render the
  recovery UI. Those remain out of scope and build on this foundation.
