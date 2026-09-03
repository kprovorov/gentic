# 4. Automatic Review lifecycle engine

Date: 2026-08-19

## Status

Accepted

## Context

GEN-413 needed a deterministic state machine turning pull-request, CI,
reviewer, and human-review events into Automatic Review progress, scoped to
each pull request and exact head SHA. The schema for it
(`review_cycles`/`review_runs`/`review_attempts`/`review_findings`,
`issue_review_policies`) already existed, but nothing decided *when* a cycle
is created vs. continued vs. superseded, how the three-attempt budget behaves
across multiple pushes, or how the automatic-review path stays distinct from
a plain human GitHub approval. Model execution, host job claiming, and
GitHub review API calls are explicitly out of scope — a future issue
dispatches the reviewer agent and publishes its verdict; this engine only
owns the state transitions.

## Decision

**A review cycle's attempt budget spans pushes, not just one commit.** A
`review_cycles` row stays `active` and keeps its 3-attempt budget across
fix-iteration pushes as long as no run was in flight when the push landed:
`evaluate_review_eligibility` updates the cycle's `head_sha` in place and
queues the next attempt. A push that lands *while* a run is `pending`/
`running` makes that run's verdict moot — the cycle is superseded
(`superseded_reason = 'new_head_sha'`), the stale run is cancelled without
consuming an attempt, and a fresh cycle with a full budget starts at the new
head SHA. A push against a cycle that already reached a terminal state
(`approved`, `exhausted`, or `superseded`) always starts a fresh cycle,
except a repeat delivery for the exact same head SHA the terminal cycle
already covers, which is a no-op (idempotent replay, and stale-SHA success
cannot reopen a concluded cycle). This is why the alternative — one cycle per
distinct head SHA — was rejected: it would let an agent loop
push→changes-requested→push forever without ever tripping the 3-strike limit
the issue asks for, defeating the point of the cap.

**Runs carry the head SHA they reviewed.** `review_runs.head_sha` (added
here) lets `fail_review_run` scope its "retry once, then stop" rule to
failures against the *current* code — a fresh push resets the infra-retry
budget instead of inheriting failures from a superseded head SHA.

**Infra-failure recovery is derived, not stored**, mirroring ADR-3. Two
consecutive failed runs at the same head SHA simply leave the cycle `active`
with no live run; nothing new queues until a human acts or new code arrives.
No new terminal state was added for this — recovery state is read off the
run history, not persisted.

**Automatic approval only comes from the engine itself.** `review_cycles`
reaches `state = 'approved'` exactly two ways: `complete_review_attempt`
recording a `verdict = 'approved'`, or the explicit `continue_with_human_review`
RPC. `recompute_issue_status_from_pull_requests` (the existing PR→Issue status
aggregator) consults that cycle state on its `approved` branch: when
`issue_review_policies.enabled` is true, every reviewable PR's latest cycle
must be in `state = 'approved'` before the Issue status may become
`approved` — a bare human GitHub approval can no longer flip it on its own.

> **Amended 2026-08-27 (GEN-428).** This started as an *additive* condition
> on top of the pre-existing `review_decision = 'approved'` check,
> specifically to keep every non-automatic-review test passing unchanged.
> That was wrong in production: GitHub's `reviewDecision` is a
> branch-protection field, null for any repository that does not *require*
> reviews, so on such a repository the base condition could never hold and
> the Issue fell back to `ready-for-review` the moment GitHub echoed our own
> published APPROVE review back through the webhook. The cycle state now
> *replaces* GitHub's decision when Automatic Review is enabled rather than
> supplementing it: the latest cycle being `approved` is both necessary and
> sufficient. The higher-precedence branches are untouched, so a human
> `changes_requested` review, failing CI, or pending CI still outrank an
> automatic approval, and Issues without Automatic Review keep their exact
> GitHub-decision behavior. See
> `supabase/migrations/20260827210000_trust_automatic_review_verdict_in_aggregator.sql`.

**A genuine human `changes_requested` review supersedes automatic review
immediately.** The webhook handler distinguishes "our own automated review
echoed back through the webhook" from a real human review by checking
whether the incoming `review.id` matches a known `review_attempts
.github_review_id`; only a non-match triggers
`supersede_active_review_cycle(..., 'human_review')`.

**Issue status transitions live in the engine, not the generic aggregator.**
`evaluate_review_eligibility` sets `reviewing` when it queues a run;
`complete_review_attempt` sets `approved`/`changes-requested` immediately on
verdict, rather than waiting for a future (out-of-scope) GitHub-publish
webhook to echo back. All of these go through a shared
`set_issue_status_from_review` guard that no-ops while the Issue has a live
implementation run (`active_run_id`) or is `completed`/`cancelled`, matching
the protection `recompute_issue_status_from_pull_requests` already gives
those statuses.

## Consequences

- The engine is fully driven by two entry points wired into the GitHub
  webhook route: `evaluate_review_eligibility` (pull request opened/ready/
  synchronized/reopened, and CI check completion/pending) and
  `supersede_active_review_cycle` (human changes-requested). Every entry
  point locks the Issue row first, so duplicate or reordered webhook
  deliveries serialize instead of racing.
- `complete_review_attempt` and `fail_review_run` are the contract a future
  reviewer-dispatch issue calls; this issue does not build the dispatcher.
- `continue_with_human_review` exists as an RPC/service function; no UI
  surfaces it yet — that is future work, same as GEN-412 left recovery UI out
  of scope.
