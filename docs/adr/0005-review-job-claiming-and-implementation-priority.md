# 5. Review job claiming and implementation priority

Date: 2026-08-19

## Status

Accepted

## Context

GEN-413 (ADR-0004) built the Automatic Review lifecycle *state machine* —
`review_cycles`/`review_runs`/`review_attempts`/`review_findings`, driven by
`evaluate_review_eligibility`, `complete_review_attempt`, `fail_review_run`,
`supersede_active_review_cycle` — but explicitly left "model execution,
worker job claiming" out of scope. As a result every pending `review_runs`
row sat unclaimed forever: nothing assigned one to a worker, tracked a
lease, sent a heartbeat, or reconciled a lost worker. GEN-414 closes that
gap, adding the worker-facing claim layer on top of the existing engine
without changing any of its state-transition semantics, while making sure
review work never wins capacity contention against implementation work —
the product's primary purpose.

Two things this issue explicitly does **not** need to build, because the
existing engine already covers them: invalidating a queued/running review
run when its pull request closes, goes draft, gets a new head SHA, or is
superseded by a genuine human changes-requested review (`evaluate_review_
eligibility` and `supersede_active_review_cycle` already cancel live runs on
every relevant GitHub webhook event, unconditionally of who, if anyone,
claimed them); and the completion/failure state transitions themselves
(`complete_review_attempt`/`fail_review_run` already exist).

**Reviewer runtime is explicitly out of scope for this issue**, same as it
was for GEN-413. `apps/gentic/src/session.ts` only knows how to run a full
coding-agent turn (clone, setup script, ACP session) — there is no lightweight
"just review this diff" session concept, and building one is a separate,
larger issue.

## Decision

**`review_runs.claimed_by_worker_id` is a permanent audit field, not a
lease that gets released.** This is a deliberate difference from `issues.
active_worker_id`/`active_run_id`, which *do* get cleared on release because
one `issues` row is reused across claim → run → finish. A `review_runs` row
is claimed at most once: `fail_review_run` (already built by GEN-413)
always creates a **fresh** row for a retry rather than resetting the failed
one. There is therefore nothing to "unclaim" — `status` moving out of
`running` is the sole liveness signal, and `claimed_by_worker_id` simply
becomes a permanent record of who executed that attempt, directly serving
the issue's "emit observable queue/claim/run identifiers" goal.

**Claiming is a single atomic RPC (`claim_review_run`), using `for update
... skip locked`**, the same pattern `reconcile_offline_worker_runs`
(GEN-412) already uses for stale workers. A second concurrent caller skips a
row already being claimed and either wins a different eligible one or finds
none — this is what makes "two workers cannot claim the same review job" a
database guarantee rather than an application-level race the caller has to
avoid.

**Every recovery path — the claim route's post-claim rollback, worker
ban/delete release, and offline-worker reconciliation — reuses
`fail_review_run`, rather than introducing a new terminal state.** That RPC
already has exactly the right semantics for "this run cannot be completed
for infrastructure reasons": no Review Attempt is consumed, it retries once
automatically, and after two consecutive failures at the same head SHA it
stops cleanly, leaving the cycle `active` with no live run — recoverable by
a human (`continue_with_human_review`) or by new code arriving. Reusing it
here means "retries resume lifecycle state rather than duplicating Review
Attempts" is satisfied for every recovery path for free, without new code
duplicating that logic.

**Offline reconciliation for review runs is a separate function and a
separate `pg_cron` job (`reconcile_offline_review_runs`, every 30s) — not an
extension of `reconcile_offline_worker_runs`.** The two use structurally
different SQL: the issues reconciler is one set-based CTE, while the review-
run reconciler must loop per row and call `fail_review_run` for its side
effects (inserting a retry row, touching `review_cycles`), which cannot be
expressed as a single CTE. Merging them into one function would also mean a
single exception aborts both halves of reconciliation for that tick.
Reconciliation excludes banned workers (mirroring the issues reconciler), so
— exactly as `issues` already requires via `requeue_worker_active_issues` —
`ban_worker` and `delete_worker` both gained a parallel call to a new
`requeue_worker_active_review_runs`, which releases a worker's claimed
review runs through the same `fail_review_run` path the moment it is
banned or deleted, rather than waiting for the 5-minute reconciliation
window that intentionally never applies to it.

**A review run's staleness is judged two ways**, not just by worker
heartbeat: `coalesce(workers.last_seen_at, workers.offline_since_at)` (the
worker is gone) **or** `coalesce(review_runs.heartbeat_at, review_runs.
started_at)` (the run itself stopped progressing on an otherwise-healthy
worker). The latter only matters once a real, potentially long-running
reviewer session exists, but the column and the agent-facing heartbeat route
are cheap to build now and let the pipeline be exercised end to end
immediately.

**Implementation priority is enforced by claim ordering on the worker CLI,
not by a combined atomic endpoint.** Every poll tick, `apps/gentic/src/
worker.ts` always calls `claimNextQueuedIssue` before ever attempting
`claimReviewRun`, and only attempts the latter if the former returned
nothing. Because `packages/services/src/workers.ts`'s `listRunningTaskCounts`
now unions counts from both `issues` and `review_runs` into one map,
implementation and review jobs share a single capacity pool per worker: a
successful implementation claim consumes the slot the review-claim's own
capacity check sees moments later. This is a client-side sequencing
guarantee via two sequential HTTP calls, not one server-side transaction —
accepted deliberately. There is a narrow, pre-existing-pattern race (a new
implementation issue appearing in the gap between the two calls can lose one
poll tick's slot to a review claim); this is not new — the existing
single-class issue claim already has the same "snapshot at claim time, not
linearizable" property for priority ordering among issues themselves.
Building a combined "claim either" endpoint would only close a window that's
already accepted practice elsewhere in this codebase, for one poll interval
of exposure. Active implementation is never paused or interrupted to start a
review by design: nothing in this claim path touches an in-flight
implementation run at all.

**The worker CLI's `processReviewRun` is a deliberate, temporary stub.**
Because there is no reviewer runtime yet, and fabricating a verdict would
corrupt real review-cycle data, every claimed review run sends one heartbeat
and then reports itself as an infrastructure failure (`fail_review_run`,
with a fixed, clearly-labeled message) rather than attempting to review
anything. This is not a hack: it reuses the exact recovery path described
above, so it is safe to ship even though nothing productive happens with a
claimed job yet — a project with Automatic Review enabled ends up with
Issues that reach a visible "stopped, needs human" state after two harmless
infra-failure retries, rather than sitting silently stuck in `reviewing`
forever (which is what happens today, pre-GEN-414, since nothing claims
pending runs at all). A future issue that builds the actual reviewer runtime
only needs to replace this one function's body — the claim, lease,
heartbeat, cancellation, reconciliation, and retry plumbing around it is
already fully wired and tested.

## Consequences

- New columns `review_runs.claimed_by_worker_id`/`heartbeat_at`, a new RPC
  `claim_review_run`, and two new agent API routes for the lease
  (`review-runs/[id]/heartbeat`) and infra-failure reporting
  (`review-runs/[id]/fail`) are the pipeline this issue delivers. A
  `review-runs/[id]/complete` route wrapping the already-existing
  `completeReviewAttempt` was also built for API completeness, but nothing
  calls it yet.
- `apps/gentic/src/worker.ts` gained a second concurrency-tracking map
  (`activeReviewRuns`) alongside `activeRuns`, both counted against the same
  `MAX_CONCURRENT_ISSUES`, and `pollControl` now also aborts a claimed
  review run whose server-side status has left `running` (the mechanism by
  which PR-close/draft/new-SHA/human-review cancellation — already fully
  implemented by GEN-413 — reaches a worker holding the claim).
- `ban_worker` and `delete_worker` (GEN-412) were extended with one call
  each to the new `requeue_worker_active_review_runs`.
- The reviewer prompt/runtime, GitHub publication of a verdict, and
  user-facing timeline rendering remain explicitly out of scope, same as
  GEN-413 left them — this issue only builds the scheduling and lease
  infrastructure a future dispatcher will use.
