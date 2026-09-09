# 12. Reconciling the `reviewing` Issue status instead of guarding every exit

Date: 2026-09-09

## Status

Accepted

## Context

GEN-449 reported two issues sitting in `reviewing` indefinitely. Both had a
Review Cycle that stopped progressing hours earlier; neither had any live
review run; nothing was ever going to write their status again.

ADR-0004 decided that "Issue status transitions live in the engine, not the
generic aggregator": `evaluate_review_eligibility` writes `reviewing` when it
queues a run, and `complete_review_attempt` writes `approved`/
`changes-requested` on the verdict. That is a *write-once-per-event* design —
it has no notion of an invariant to restore, so it only holds while every
event that ends a cycle also writes the status. Several don't, by design:

- `fail_review_run` spends its one automatic retry and then deliberately
  stops, leaving the cycle `active` with no live run (documented in
  `docs/web/automatic-review.mdx`).
- `complete_review_attempt` returns `accepted = false` for a verdict landing
  against a cancelled/superseded run, a non-`active` cycle, or a fourth
  attempt, and records nothing.
- Its `approved` branch forces no status at all when the sibling-pull-request
  gate (GEN-430) isn't satisfied — deliberately, because guessing there risks
  clobbering a sibling's higher-priority status.
- `evaluate_review_eligibility` cancels the live run the moment the pull
  request stops being eligible (CI goes non-green, the PR is closed or
  converted to draft) and queues nothing behind it.
- `set_issue_status_from_review` no-ops silently on four separate conditions,
  which is precisely what makes it safe to call from anywhere.

None of these raise. `complete_review_attempt` still returns success, and the
host logged `completed with verdict: approved` for a verdict the database had
discarded — so the failure was invisible from both ends.

## Decision

**Reconcile the invariant on a schedule rather than add a status write to
each exit.** `reconcile_stuck_reviewing_issues` (pg_cron, every minute) finds
issues in `reviewing` with no running review run and no *claimable* pending
one, and calls `recompute_issue_status_from_pull_requests` on them.

The list of ways a cycle can stop early is open-ended — three of the five
above were added after ADR-0004 — so patching each exit is a losing game that
also has to re-derive, at each site, the cross-pull-request state the
aggregator already knows. Reconciliation costs one function and converges all
of them, including exits that don't exist yet.

**This narrows ADR-0004's "transitions live in the engine", it does not
reverse it.** The engine still owns every transition driven by an event. The
aggregator is consulted only where the engine has, by its own rules, declined
to act — and it is the right authority there, because the question at that
point is exactly the one it answers: given these pull requests and their
cycles, what is this Issue's status? The two agree by construction, since the
aggregator reports `reviewing` under exactly the condition that keeps a row
out of the reconciler's selection.

**"Live" means claimable, not merely `pending`.** A pending run behind a
concluded cycle or a no-longer-reviewable pull request is one `claim_review_
run` will never return, so treating it as an in-flight review would recreate
the same stuck state the reconciler exists to clear.

**Only a status the engine produced is reconciled.** `reviewing` is an
ordinary selectable status, so an issue with no Review Cycle at all was put
there by its owner and is left alone; without that guard the reconciler would
quietly overrule a deliberate manual state two minutes later.

**A two-minute grace window on `issues.updated_at` keeps this a safety net.**
Anything genuinely stuck stays stuck for far longer, so the window costs
nothing and guarantees the reconciler never races a transition that is still
settling.

## Consequences

- `reviewing` now means a reviewer really is looking at the code. A cycle
  that approved but never reached the Issue converges to `approved`; a
  dead-ended one converges to `ready-for-review`, where **Retry review** is
  offered. Neither fabricates a Review Attempt or a verdict — the cycle and
  its attempt budget are untouched.
- The correction is an ordinary `status_changed` timeline event, not a new
  event type, so existing timeline rendering covers it.
- The host now distinguishes a recorded verdict from a discarded one in its
  logs (`accepted` on the complete-run response was previously dropped),
  so this class of silent loss is diagnosable without database access.
- A stranded pending run still isn't cleaned up — it stays `pending`
  forever, just no longer holding the Issue hostage. Reaping those is
  separate work; `reconcile_offline_review_runs` only covers `running` ones.
- Publishing to GitHub still happens before the verdict is recorded
  (`review-runs/[id]/complete`), so a superseded run can leave a real review
  on the pull request that the database then discards. The reconciler
  ensures the *Issue* recovers; closing that window itself is future work.
